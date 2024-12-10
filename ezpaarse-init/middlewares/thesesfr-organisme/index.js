'use strict';

const co = require('co');
const request = require('request');
const { bufferedProcess, wait } = require('../utils.js');
const cache = ezpaarse.lib('cache')('thesesfr-organisme');

module.exports = function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    logger.info('Initializing ABES thesesfr-organisme middleware');

    const cacheEnabled = !/^false$/i.test(req.header('thesesfr-organisme-cache'));

    logger.info(`Thesesfr cache: ${cacheEnabled ? 'enabled' : 'disabled'}`);

    // Time-to-live of cached documents
    let ttl = parseInt(req.header('thesesfr-ttl'));
    // Minimum wait time before each request (in ms)
    let throttle = parseInt(req.header('thesesfr-throttle'));
    // Maximum enrichment attempts
    let maxTries = parseInt(req.header('thesesfr-max-tries'));
    // Base wait time after a request fails
    let baseWaitTime = parseInt(req.header('thesesfr-base-wait-time'));
    // Maximum number of Theses or Persons to query
    let packetSize = parseInt(req.header('thesesfr-packet-size'));
    // Minimum number of ECs to keep before resolving them
    let bufferSize = parseInt(req.header('thesesfr-buffer-size'));
    if (isNaN(packetSize)) { packetSize = 100; } //Default : 50
    if (isNaN(bufferSize)) { bufferSize = 1000; } //Default : 1000

    let baseUrl = "https://theses.fr/api/v1/theses/getorganismename/";

    if (isNaN(baseWaitTime)) { baseWaitTime = 1000; }
    if (isNaN(maxTries)) { maxTries = 5; }
    if (isNaN(throttle)) { throttle = 100; }
    if (isNaN(ttl)) { ttl = 3600 * 24 * 7; }

    if (!cache) {
        const err = new Error('failed to connect to mongodb, cache not available for Thesesfr');
        err.status = 500;
        return err;
    }

    report.set('thesesfr-organisme', 'thesesfr-queries', 0);
    report.set('thesesfr-organisme', 'thesesfr-query-fails', 0);
    report.set('thesesfr-organisme', 'thesesfr-cache-fails', 0);

    const process = bufferedProcess(this, {
        packetSize,
        bufferSize,
        /**
         * Filter ECs that should be enriched
         * @param {Object} ec
         * @returns {Boolean|Promise} true if the EC should be enriched, false otherwise
         */
        filter: ec => {
            if (!ec.unitid) { return false; }
            if (!(ec.rtype === 'RECORD')) { return false; } //pas la peine d'interroger le cache mongodb si l'EC n'est pas un organisme
            if (!cacheEnabled) { return true; }

            return findInCache(ec.unitid).then(cachedDoc => {

            //TMX cas ou il y a un objet : dans le cas de thesesfr-organismes il sera forcemment vide {} = convention identique aux autres middlewares
                if (cachedDoc && (typeof cachedDoc === 'object')) {

                    //logger.debug ('cached doc est un objet');

                    if(Object.keys(cachedDoc).length === 0){
                            logger.warn('missed cache, doc from thesesfr-organisme est un objet vide pour ec.unitid '+ec.unitid+ ' ec.rtype '+ec.rtype);
                     }
                    else {
                    //logger.debug('le doc pour enrichEc un '+ec.rtype+' provient du cache thesesfr-organisme');
                    //logger.debug('cached doc est un objet NON VIDE avec '+ Object.keys(cachedDoc).length +' propriétés');

                     enrichEc(ec, cachedDoc);
                     return false;
                    }

                }
            //TMX cas "normal" dans thesesfr-organisme la réponse est une chaine de texte, deux sous-cas : vide ou pas vide
                if (cachedDoc && typeof cachedDoc !== 'object') {

                    if(cachedDoc.length === 0){
                            logger.warn('missed cache, doc from thesesfr-organisme DIFFERENT de objet mais taille 0 pour ec.unitid '+ec.unitid+ ' ec.rtype '+ec.rtype);
                     }
                    else {
                    //logger.debug('le doc pour enrichEc un '+ec.rtype+' provient du cache thesesfr-organisme');
                     enrichEc(ec, cachedDoc);
                     return false;
                    }

                }


                return true;
            });
        },

        onPacket: co.wrap(onPacket)
    });

    return new Promise(function (resolve, reject) {
        // Verify cache indices and time-to-live before starting
        cache.checkIndexes(ttl, function (err) {
            if (err) {
                logger.error(`Thesesfr:  failed to verify indexes : ${err}`);
                return reject(new Error('failed to verify indexes for the cache of Thesesfr'));
            }

            resolve(process);
        });
    });

    /**
     * Process a packet of ECs
     * @param {Array<Object>} ecs
     * @param {Map<String, Set<String>>} groups
     */
    function* onPacket({ ecs }) {

        if (ecs.length === 0) { return; }

        for (const [ec, done] of ecs) {

            let id;
            id = ec.unitid;



            const maxAttempts = 5;
            let tries = 0;
            let doc;

            while (!doc) {
                if (++tries > maxAttempts) {
                    const err = new Error(`Failed to query Thesesfr from thesesfr-organisme ${maxAttempts} times in a row`);
                    return Promise.reject(err);
                }

                try {
                    if (ec.rtype === 'RECORD') {
                        doc = yield query(id);
                        //logger.debug('le doc pour enrichEc un '+ec.rtype+' provient de onPacket thesesfr-organisme');
                    }
                    else
                    {
                        doc={};
                    }
                } catch (e) {
                    logger.error(`Thesesfr erreur yield query dans thesesfr-organisme : ${e.message}`);
                }

                yield wait(throttle);
                yield wait(tries === 0 ? throttle : baseWaitTime * Math.pow(2, tries));
            }



            const unitid = ec.unitid;

            try {
                // If we can't find a result for a given ID, we cache an empty document
                yield cacheResult(unitid, doc || {});
            } catch (e) {
                report.inc('thesesfr-organisme erreur yield cacheResult ', 'thesesfr-cache-fails');
            }



            if (doc && (typeof doc === 'object')) {

                if(Object.keys(doc).length === 0){
                  //NOP
                }
                else {
                    logger.warn ('CAS IMPREVU !!! objet réponse est un objet NON VIDE avec '+ Object.keys(doc).length +' propriétés');

                }
            }

            if (doc && doc.missing) {
                //logger.debug(`Missing data for ID ${id}. Enriching with default values.`);
                enrichEc(ec, doc);
            }


            if (doc && typeof doc !== 'object') {

                if(doc.length === 0){
                    //logger.debug('objet réponse DIFFERENT de objet mais taille 0 pour id '+id);
                    //NOP
                }
                else {

                    enrichEc(ec, doc);
                }

            }

            done();
        }

    }


    /**
     * Enrich an EC using a forged result (absent from quey response)
     * @param {Object} ec the EC to be enriched
     * @param {Object} result the forged document used to enrich the EC
     */
    function enrichForgedEc(ec, result) {
        /** version Check EC qualification : middleware qualifier-other + middleware qualifer */
        /*    ec.rtype = 'OTHER'*/

        /** version rtype OTHER et tous les champs 'NOT_FOUND'*/
        ec['rtype']='OTHER';

        ec['nnt'] ='NOT_FOUND';
        ec['numSujet'] ='NOT_FOUND';
        ec['etabSoutenanceN'] ='NOT_FOUND';
        ec['etabSoutenancePpn'] ='NOT_FOUND';
        ec['codeCourt'] ='NOT_FOUND';
        ec['dateSoutenance'] ='NOT_FOUND';
        ec['anneeSoutenance'] ='NOT_FOUND';
        ec['dateInscription'] ='NOT_FOUND';
        ec['anneeInscription'] ='NOT_FOUND';
        ec['statut'] ='NOT_FOUND';
        ec['discipline'] ='NOT_FOUND';
        ec['ecoleDoctoraleN'] ='NOT_FOUND';
        ec['ecoleDoctoralePpn'] ='NOT_FOUND';
        ec['partenaireRechercheN'] ='NOT_FOUND';
        ec['partenaireRecherchePpn'] ='NOT_FOUND';
        ec['auteurN'] ='NOT_FOUND';
        ec['auteurPpn'] ='NOT_FOUND';
        ec['directeurN'] ='NOT_FOUND';
        ec['directeurPpn'] ='NOT_FOUND';
        ec['presidentN'] ='NOT_FOUND';
        ec['presidentPpn'] ='NOT_FOUND';
        ec['rapporteursN'] ='NOT_FOUND';
        ec['rapporteursPpn'] ='NOT_FOUND';
        ec['membresN'] ='NOT_FOUND';
        ec['membresPpn'] ='NOT_FOUND';
        ec['personneN'] ='NOT_FOUND';
        ec['personnePpn'] ='NOT_FOUND';
        ec['organismeN'] ='NOT_FOUND';
        ec['organismePpn'] ='NOT_FOUND';
        ec['idp_etab_nom'] ='NOT_FOUND';
        ec['idp_etab_ppn'] ='NOT_FOUND';
        ec['idp_etab_code_court'] ='NOT_FOUND';
        ec['platform_name'] ='NOT_FOUND';
        ec['publication_title'] ='NOT_FOUND';

    }

    /**
     * Enrich an EC using the result of a query
     * @param {Object} ec the EC to be enriched
     * @param {Object} result the document used to enrich the EC
     */

    function enrichEc(ec, result) {
        if( result && (typeof result === 'object') && (Object.keys(result).length === 0)) {
            //logger.debug ('result est un objet NON VIDE avec '+ Object.keys(result).length +' propriétés, contenu : '+result)
            //NOP
        }

        if (result && result.missing)  {
            //logger.debug('le doc '+result.id+' pour enrichEc un ' + ec.rtype + ' a été forgé car absent de la réponse API');
            enrichForgedEc(ec, result);
            return; //on sort
        }

        //il s'agit d'un Organisme (PPN)
        if (result && (typeof result === 'string') && (result.length !== 0)) {
            ec['organismeN'] = result;
            ec['organismePpn'] = ec.unitid;
            ec.rtype = 'ORGANISME';
            //logger.debug(' organisme enrichi ==> ' + ec['rtype'] + ' ' + ec['organismeN'] + ' ' +ec['organismePpn']);
            ec['nnt']= 'sans objet';
            ec['numSujet']= 'sans objet';
            /*//doiThese > sans objet > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
              //ec['doiThese]'= 'sans objet';*/
            ec['etabSoutenanceN']= 'sans objet';
            ec['etabSoutenancePpn']= 'sans objet';
            ec['codeCourt']= 'sans objet';
            ec['dateSoutenance']= 'sans objet';
            ec['anneeSoutenance']= 'sans objet';
            ec['dateInscription']= 'sans objet';
            ec['anneeInscription']= 'sans objet';
            ec['statut']= 'sans objet';
            /*// accessible > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            ec['accessible'] = 'sans objet';*/
            /*// source > sans objet > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            ec['source']= 'sans objet';
            }*/
            ec['discipline']= 'sans objet';
            /*// domaine > obligatoire  > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            ec['domaine'] = 'sans objet';
            }*/
            /*// langue > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
                          ec['langue'] = 'sans objet';*/
            ec['ecoleDoctoraleN']= 'sans objet';
            ec['ecoleDoctoralePpn']= 'sans objet';
            ec['partenaireRechercheN']= 'sans objet';
            ec['partenaireRecherchePpn']= 'sans objet';
            /*//coTutelleN, coTutellePpn > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)*/
            ec['auteurN']= 'sans objet';
            ec['auteurPpn']= 'sans objet';
            ec['directeurN']= 'sans objet';
            ec['directeurPpn']= 'sans objet';
            ec['presidentN']= 'sans objet';
            ec['presidentPpn']= 'sans objet';
            ec['rapporteursN']= 'sans objet';
            ec['rapporteursPpn']= 'sans objet';
            ec['membresN']= 'sans objet';
            ec['membresPpn']= 'sans objet';
            ec['personneN']= 'sans objet';
            ec['personnePpn']= 'sans objet';
            ec['idp_etab_nom'] = 'sans objet';
            ec['idp_etab_ppn'] = 'sans objet';
            ec['idp_etab_code_court'] = 'sans objet';
            ec['platform_name']= 'Organisme';

        }
    }


    /**
     * Request metadata from ThesesFr API for given IDs
     * @param {Array} unitids the ids to query
     */


    function query(id) {
        report.inc('thesesfr-organisme', 'thesesfr-queries');

        const userAgent = 'ezPAARSE (https://readmetrics.org; mailto:ezteam@couperin.org)';

        return new Promise((resolve, reject) => {
            const options = {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent
                },
                uri: `${baseUrl}${id}`
            };

            request(options, (err, response, result) => {
                if (err) {
                    report.inc('thesesfr-organisme', 'thesesfr-query-fails');
                    return reject(err);
                }

                if (response.statusCode === 404) {
                    return resolve({});
                }

                if (response.statusCode !== 200 && response.statusCode !== 304) {
                    report.inc('thesesfr-organisme', 'thesesfr-query-fails');
                    return reject(new Error(`${response.statusCode} ${response.statusMessage}`));
                }
				
				if ((response.statusCode === 200) && (!(Number(response.headers['content-length']) > 0))) {               
                    report.inc('thesesfr-organisme', 'thesesfr-query-empty-response');
                    return resolve({ missing: true });
                }

                if (!(Number(response.headers['content-length']) > 0)) {
                    report.inc('thesesfr-organisme', 'thesesfr-query-empty-response');
                    return resolve({});
                }

                return resolve(result);
            });
        });
    }

    /**
     * Cache an item with a given ID
     * @param {String} id the ID of the item
     * @param {Object} item the item to cache
     */
    function cacheResult(id, item) {
        return new Promise((resolve, reject) => {
            if (!id || !item) { return resolve(); }

            cache.set(id, item, (err, result) => {
                if (err) { return reject(err); }
                resolve(result);
            });
        });
    }

    /**
     * Find the item associated with a given ID in the cache
     * @param {String} identifier the ID to find in the cache
     */
    function findInCache(identifier) {
        return new Promise((resolve, reject) => {
            if (!identifier) { return resolve(); }

            cache.get(identifier, (err, cachedDoc) => {
                if (err) { return reject(err); }
                resolve(cachedDoc);
            });
        });
    }
};
