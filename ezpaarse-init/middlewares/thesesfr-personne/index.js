'use strict';

const co = require('co');
const request = require('request');
const { bufferedProcess, wait } = require('../utils.js');
const cache = ezpaarse.lib('cache')('thesesfr-personne');

module.exports = function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    logger.info('Initializing ABES thesesfr-personne middleware');

    const cacheEnabled = !/^false$/i.test(req.header('thesesfr-personne-cache'));

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

    let baseUrl = "https://theses.fr/api/v1/personnes/recherche/";

    if (isNaN(baseWaitTime)) { baseWaitTime = 10; } //1000
    if (isNaN(maxTries)) { maxTries = 5; }
    if (isNaN(throttle)) { throttle = 10; } //100
    if (isNaN(ttl)) { ttl = 3600 * 24 * 7; }

    if (!cache) {
        const err = new Error('failed to connect to mongodb, cache not available for Thesesfr');
        err.status = 500;
        return err;
    }

    report.set('thesesfr-personne', 'thesesfr-queries', 0);
    report.set('thesesfr-personne', 'thesesfr-query-fails', 0);
    report.set('thesesfr-personne', 'thesesfr-cache-fails', 0);

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
            if (!(ec.rtype === 'RECORD')) { return false; } //pas la peine d'interroger le cache mongodb si l'EC n'est pas une personne/organisme
            if (!cacheEnabled) { return true; }

            return findInCache(ec.unitid).then(cachedDoc => {
                if (cachedDoc) {

                    if(Object.keys(cachedDoc).length === 0){
                       logger.warn('missed cache, doc from thesesfr-personne est un objet vide pour ec.unitid '+ec.unitid+ ' ec.rtype '+ec.rtype);
                     }
                    else {
                    logger.info('le doc pour enrichEc un '+ec.rtype+' provient du cache thesesfr-personne');
                     enrichEc(ec, cachedDoc);
                    }
                    return false;
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
                logger.error(`Thesesfr: failed to verify indexes : ${err}`);
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

        const unitids = ecs.filter(([ec, done]) => ec.rtype === 'RECORD').map(([ec, done]) => ec.unitid);

        const maxAttempts = 5;
        let tries = 0;
        let docs;

                //logger.info('dans onPacket avant le while');

        while (!docs) {
            if (++tries > maxAttempts) {
                const err = new Error(`Failed to query Thesesfr ${maxAttempts} times in a row`);
                return Promise.reject(err);
            }

            try {
                //logger.info('avant query');
                docs = yield query(unitids);
            } catch (e) {
                logger.error(`Thesesfr: ${e.message}`);
            }

            yield wait(throttle);
            yield wait(tries === 0 ? throttle : baseWaitTime * Math.pow(2, tries));
        }

        const docResults = new Map();
        docs.forEach(doc => {
            if (doc && doc.id) {
                docResults.set(doc.id, doc);
            }
        });

        for (const [ec, done] of ecs) {
            const unitid = ec.unitid;
            const doc = docResults.get(unitid);

            try {
                // If we can't find a result for a given ID, we cache an empty document
                yield cacheResult(unitid, doc || {});
            } catch (e) {
                report.inc('thesesfr-personne', 'thesesfr-cache-fails');
            }

            if (doc) {
                logger.info('le doc pour enrichEc un '+ec.rtype+' provient de onPacket thesesfr-personne');
                enrichEc(ec, doc);
            }

            done();
        }

    }

    /**
     * Enrich an EC using the result of a query
     * @param {Object} ec the EC to be enriched
     * @param {Object} result the document used to enrich the EC
     */

    /* ERM header cible
  	# -H "Output-Fields: +nnt, +numSujet, +doiThese, +etabSoutenanceN, +etabSoutenancePpn, +codeCourt, +dateSoutenance, +anneeSoutenance, +dateInscription, +anneeInscription, +statut, +accessible, +source, +discipline, +domaine, +langue, +ecoleDoctoraleN, +ecoleDoctoralePpn, +partenaireRechercheN, +partenaireRecherchePpn, +cotutelleN, +cotutellePpn, +auteurN, +auteurPpn, +directeurN, +directeurPpn, +presidentN, +presidentPpn, +rapporteursN, +rapporteursPpn, +membresN, +membresPpn, +personneN, +personnePpn, +organismeN, +organismePpn, +idp_etab_nom, +idp_etab_ppn, +idp_etab_code_court, +platform_name " \
     */

    function enrichEc(ec, result) {

        //il s'agit d'une Personne (PPN)
            if (result.nom && result.prenom) {
                ec['personneN'] = result.nom+ " "+result.prenom;
            ec['personnePpn'] = ec.unitid;
            // TMX changer le ec.rtype pour 'BIO' afin de les ignorer dans le middleware suivant qui devra traiter uniquement les ec d'organismes restant toujours à 'RECORD'
            ec.rtype = 'BIO'
            logger.info(' personne enrichie ==> ' + ec['rtype'] + ' ' + ec['personneN'] + ' ' +ec['personnePpn']);
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
                ec['organismeN']= 'sans objet';
                ec['organismePpn']= 'sans objet';
                ec['idp_etab_nom'] = 'sans objet';
                ec['idp_etab_ppn'] = 'sans objet';
                ec['idp_etab_code_court'] = 'sans objet';
                ec['platform_name']= 'sans objet';
            }
    }

    /**
     * Request metadata from ThesesFr API for given IDs
     * @param {Array} unitids the ids to query
     */
    function query(unitids) {
        report.inc('thesesfr-personne', 'thesesfr-queries');

        const subQueries = [];
        const ppns  = [];

        unitids.forEach(id => {
            ppns.push(id);
        });

        if (ppns.length > 0) {
            subQueries.push(`${ppns.join(' OR ')}`);
        }

        const query = `?nombre=200&q=${subQueries.join(' OR ')}`;
        logger.info(' query ==> ' + query);

        return new Promise((resolve, reject) => {
            const options = {
                method: 'GET',
                json: true,
                uri: `${baseUrl}${query}`
            };

            request(options, (err, response, result) => {
                if (err) {
                    report.inc('thesesfr-personne', 'thesesfr-query-fails');
                    return reject(err);
                }

                if (response.statusCode === 404) {
                    return resolve({});
                }

                if (response.statusCode !== 200 && response.statusCode !== 304) {
                    report.inc('thesesfr-personne', 'thesesfr-query-fails');
                    return reject(new Error(`${response.statusCode} ${response.statusMessage}`));
                }

                if (!Array.isArray(result && result.personnes)) {
                    report.inc('thesesfr-personne', 'thesesfr-query-fails');
                    return reject(new Error('invalid response'));
                }

                return resolve(result.personnes);
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
