'use strict';

const co = require('co');
const request = require('request');
const fs = require('fs');
const path = require('path');
const { bufferedProcess, wait } = require('../utils.js');
const cache = ezpaarse.lib('cache')('thesesfr');

module.exports = function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    let list_code_court;
    let list_idp;

    logger.info('Initializing ABES thesesfr middleware');

    const cacheEnabled = !/^false$/i.test(req.header('thesesfr-cache'));

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
    if (isNaN(packetSize)) {
        packetSize = 100;
    } //Default : 50
    if (isNaN(bufferSize)) {
        bufferSize = 1000;
    } //Default : 1000

    let baseUrl = "https://theses.fr/api/v1/theses/recherche/";

    if (isNaN(baseWaitTime)) {
        baseWaitTime = 10;
    } //1000
    if (isNaN(maxTries)) {
        maxTries = 5;
    }
    if (isNaN(throttle)) {
        throttle = 10;
    } //100
    if (isNaN(ttl)) {
        ttl = 3600 * 24 * 7;
    }

    if (!cache) {
        const err = new Error('failed to connect to mongodb, cache not available for Thesesfr');
        err.status = 500;
        return err;
    }

    report.set('thesesfr', 'thesesfr-queries', 0);
    report.set('thesesfr', 'thesesfr-query-fails', 0);
    report.set('thesesfr', 'thesesfr-cache-fails', 0);

    const process = bufferedProcess(this, {
        packetSize,
        bufferSize,
        /**
         * Filter ECs that should be enriched
         * @param {Object} ec
         * @returns {Boolean|Promise} true if the EC should be enriched, false otherwise
         */
        filter: ec => {
            if (!ec.unitid) {
                return false;
            }
            if (!((ec.rtype === 'PHD_THESIS') || (ec.rtype === 'ABS'))) {
                return false;
            } //pas la peine d'interroger le cache mongodb si l'EC n'est pas une thèses/une notice de thèse
            if (!cacheEnabled) {
                return true;
            }

            return findInCache(ec.unitid).then(cachedDoc => {
                if (cachedDoc) {

                    if (Object.keys(cachedDoc).length === 0) {
                        logger.warn('missed cache, doc from thesesfr est un objet vide pour ec.unitid ' + ec.unitid + ' ec.rtype ' + ec.rtype);
                    } else {
                        logger.info('le doc pour enrichEc un ' + ec.rtype + ' provient du cache thesesfr');
                        enrichEc(ec, cachedDoc);
                    }
                    return false;
                }
                return true;
            });
        },

        onPacket: co.wrap(onPacket)
    });


    /**
     * Chargement des mappings Code Court et IdP avec les web services de Movies (accès interne Abes)
     *
     * https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_code_court.json
     * https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_idp.json
     *
     * Si l'url n'est pas accessible, le middleware utilisera la copie du mapping list_code_court.json et list_idp.json
     *
     */
    const promiseCodeCourt = new Promise((resolveCodeCourt, rejectCodeCourt) => {

        //Chargement du mapping par appel au web service Movies
        const optionsCodeCourt = {
            method: 'GET',
            json: true,
            uri: `https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_code_court.json`
        };

        request(optionsCodeCourt, (errCodeCourt, responseCodeCourt, resultCodeCourt) => {

            //Si erreur, chargement du fichier list_code_court.json, a la place
            if (errCodeCourt || responseCodeCourt.statusCode !== 200) {
                chargeMapping('list_code_court.json', resolveCodeCourt, rejectCodeCourt);
            };

            if (!errCodeCourt && responseCodeCourt.statusCode == 200) {
                if (Array.isArray(resultCodeCourt.results.bindings)) {
                    logger.info('Chargement du mapping Code court, par web service OK');
                    resolveCodeCourt(resultCodeCourt);
                }
                else {
                    //Si erreur, chargement du fichier list_code_court.json, a la place
                    chargeMapping('list_code_court.json', resolveCodeCourt, rejectCodeCourt);
                }
            };

        });
    });


    const promiseIdP = new Promise((resolveIdP, rejectIdP) => {
        //Chargement du mapping par appel au web service Movies
        const optionsIdP = {
            method: 'GET',
            json: true,
            uri: `https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_idp.json`
        };

        request(optionsIdP, (errIdP, responseIdP, resultIdP) => {
            //Si erreur, chargement du fichier list_idp.json, a la place
            if (errIdP || responseIdP.statusCode !== 200) {
                chargeMapping('list_idp.json', resolveIdP, rejectIdP);
            };

            if (!errIdP && responseIdP.statusCode == 200) {
                if (Array.isArray(resultIdP.results.bindings)) {
                    logger.info('Chargement du mapping IdP par web service OK');
                    resolveIdP(resultIdP);
                }
                else {
                    //Si erreur, chargement du fichier list_idp.json, a la place
                    chargeMapping('list_idp.json', resolveIdP, rejectIdP);
                }
            };

            resolveIdP("resolveIdP");
        });
    });

    //Chargement du mapping par fichier (list_code_court.json ou list_idp.json)
    function chargeMapping(nomFichier, resolve, reject){
        fs.readFile(path.resolve(__dirname, nomFichier), 'utf8', (err, content) => {
            if (err) {
                return reject(err);
            }

            try {
                logger.info('Erreur chargement du mapping par web service : chargement par le fichier '+nomFichier+' OK');
                return resolve(JSON.parse(content));
            } catch (e) {
                return reject(e);
            }
        });
    }


    return new Promise(function (resolve, reject) {
        // Verify cache indices and time-to-live before starting
        cache.checkIndexes(ttl, function (err) {
            if (err) {
                logger.error(`Thesesfr: failed to verify indexes : ${err}`);
                return reject(new Error('failed to verify indexes for the cache of Thesesfr'));
            }

            Promise.all([promiseCodeCourt,promiseIdP]).then((promises) => {
                list_code_court = promises[0];
                list_idp = promises[1];
                resolve(process);
            });
        });
    });


    /**
     * Process a packet of ECs
     * @param {Array<Object>} ecs
     * @param {Map<String, Set<String>>} groups
     */
    function* onPacket({ecs}) {

        if (ecs.length === 0) {
            return;
        }

        const unitids = ecs.filter(([ec, done]) => (ec.rtype === 'PHD_THESIS') || (ec.rtype === 'ABS')).map(([ec, done]) => ec.unitid);

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
                report.inc('thesesfr', 'thesesfr-cache-fails');
            }

            if (doc) {
                logger.info('le doc pour enrichEc un ' + ec.rtype + ' provient de onPacket thesesfr');
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
        logger.info(' debut enrich ');
        /*
         ******Tronc commun*****
         */
        // etabSoutenanceN > obligatoire
        if (result.etabSoutenanceN) {
            ec['etabSoutenanceN'] = result.etabSoutenanceN;
        }

        // etabSoutenancePpn > obligatoire
        if (result.etabSoutenancePpn) {
            ec['etabSoutenancePpn'] = result.etabSoutenancePpn;
        }

        // codeCourt > obligatoire > via Api Movies

        var eltCodeCourt = list_code_court.results.bindings.find(elt => elt.ppn.value ===  result.etabSoutenancePpn);
        if (eltCodeCourt) {
            ec['codeCourt'] = eltCodeCourt.codeCourt.value;
            ec['platform_name'] = eltCodeCourt.codeCourt.value;

        }
        //statut > obligatoire
        if (result.status) {
            ec['statut'] = result.status;
        }

        /*// TODO source > obligatoire > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
        if (result.source) {
            ec['statut'] = result.source;
        }*/

        //discipline > obligatoire
        if (result.discipline) {
            ec['discipline'] = result.discipline;
        }
        /*// TODO domaine > obligatoire  > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
        if (result.domaine) {
        ec['domaine'] = result.domaine;
        }*/

        // partenairesDeRecherche > répétable > nom + prenom facultatif / ppn facultatif
        if (result.partenairesDeRecherche == null || result.partenairesDeRecherche == '') {
            ec['partenaireRechercheN'] = 'NR';
            ec['partenaireRecherchePpn'] = 'NR';
        } else {
            ec['partenaireRechercheN'] =  result.partenairesDeRecherche.map(elt => {
                if (elt.nom == null || elt.nom =='') { return 'NR'}
                else { return elt.nom}
            }).join(" / ");
            ec['partenaireRecherchePpn'] = result.partenairesDeRecherche.map(elt => {
                if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                else { return elt.ppn}
            }).join(" / ")
        }

        /*// TODO coTutelleN, coTutellePpn > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)*/

        // auteurs > répétable > nom + prenom obligatoire / ppn facultatif
        if (result.auteurs) {
            ec['auteurN'] = result.auteurs.map(elt => elt.nom + " " + elt.prenom).join(" / ");
            ec['auteurPpn'] = result.auteurs.map(elt => {
                if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                else { return elt.ppn}
            }).join(" / ");
        }

        // directeurs > répétable > nom + prenom obligatoire / ppn facultatif
        if (result.directeurs) {
            ec['directeurN'] = result.directeurs.map(elt => elt.nom + " " + elt.prenom).join(" / ");
            ec['directeurPpn'] = result.directeurs.map(elt => {
                if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                else { return elt.ppn}
            }).join(" / ");
        }

        // president > nom + prenom facultatif / ppn facultatif
        if (result.president.nom && result.president.prenom) {
            ec['presidentN'] = result.president.nom + " " + result.president.prenom;
        } else {
            ec['presidentN'] = 'NR';
        }
        if (result.president.ppn) {
            ec['presidentPpn'] = result.president.ppn;
        } else {
            ec['presidentPpn'] = 'NR';
        }

        // rapporteurs > répétable > nom + prenom facultatif / ppn facultatif
        if (result.rapporteurs == null || result.rapporteurs == '') {
            ec['rapporteursN'] = 'NR';
            ec['rapporteursPpn'] = 'NR';
        } else {
            ec['rapporteursN'] =  result.rapporteurs.map(elt => {
                if (elt.nom == null || elt.nom =='') { return 'NR'}
                else { return (elt.nom + " " + elt.prenom)}
            }).join(" / ");
            ec['rapporteursPpn'] = result.rapporteurs.map(elt => {
                if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                else { return elt.ppn}
            }).join(" / ")
        }

        // examinateurs > répétable > nom + prenom facultatif / ppn facultatif
        if (result.examinateurs == null || result.examinateurs == '') {
            ec['membresN'] = 'NR';
            ec['membresPpn'] = 'NR';
        } else {
            ec['membresN'] =  result.examinateurs.map(elt => {
                if (elt.nom == null || elt.nom =='') { return 'NR'}
                else { return (elt.nom + " " + elt.prenom)}
            }).join(" / ");
            ec['membresPpn'] = result.examinateurs.map(elt => {
                if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                else { return elt.ppn}
            }).join(" / ")
        }

        // les 'sans objet' pour les notices thèses et sujets + accès document thèse
        ec['personneN'] = 'sans objet';
        ec['personnePpn'] = 'sans objet';
        ec['organismeN'] = 'sans objet';
        ec['organismePpn'] = 'sans objet';
        // les 'sans objet' pour les notices thèses et sujets + accès document thèse non soumis à authentification
        ec['idp_etab_nom'] = 'sans objet';
        ec['idp_etab_ppn'] = 'sans objet';
        ec['idp_etab_code_court'] = 'sans objet';

        /*
         ******* Spécificités pour Thèse en cours : status = 'enCours'******
         */
        if (result.status === 'enCours') {

            //NNT facultatif
            if (result.nnt) {
                ec['nnt'] = result.nnt;
            } else {
                ec['nnt'] = 'NR';
            }

            //numSujet > obligatoire
            if (result.id) {
                ec['numSujet'] = result.id;
            }

            /*// TODO doiThese > sans objet > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
             ec['doiThese'] = 'sans objet';*/

            // dateSoutenance et anneSoutenance > facultative
            if (result.dateSoutenance) {
                ec['dateSoutenance'] = result.dateSoutenance;
                ec['anneeSoutenance'] = result.dateSoutenance.substring(6, 10);
            } else {
                ec['dateSoutenance'] = 'NR';
                ec['anneeSoutenance'] = 'NR';
            }

            // dateInscription et anneInscription > obligatoire
            if (result.datePremiereInscriptionDoctorat) {
                ec['dateInscription'] = result.datePremiereInscriptionDoctorat;
                ec['anneeInscription'] = result.datePremiereInscriptionDoctorat.substring(6, 10);
            }

            /*// TODO accessible > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            ec['accessible'] = 'sans objet';*/

            /*// TODO langue > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            ec['langue'] = 'sans objet';*/

            // ecolesDoctorale > répétable > nom obligatoire / ppn facultatif
            if (result.ecolesDoctorale) {
                ec['ecoleDoctoraleN'] = result.ecolesDoctorale.map(elt => elt.nom).join(" / ");
                ec['ecoleDoctoralePpn'] = result.ecolesDoctorale.map(elt => {
                    if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                    else { return elt.ppn}
                }).join(" / ");
            }
        }

        /*
        ******* Spécificités pour Thèse : status = 'soutenue' ********
        */
        if (result.status === 'soutenue') {

            //NNT obligatoire
            if (result.nnt) {
                ec['nnt'] = result.nnt;
            }

            //numSujet > sans objet
            ec['numSujet'] = 'sans objet';

            /* // TODO doiThese > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            if (result.doi) {
           ec['doiThese'] = result.doi;
           } else {
           ec['doiThese'] = 'NR';
            }*/

            /* // Code court de l'étab de soutenance > obligatoire > récupéré via API movies
            en attendant rempli par le tronc commune 'sans objet'
             */

            // dateSoutenance et anneSoutenance > obligatoire
            if (result.dateSoutenance) {
                ec['dateSoutenance'] = result.dateSoutenance;
                ec['anneeSoutenance'] = result.dateSoutenance.substring(6, 10);
            }

            // dateInscription et anneInscription > 'sans objet'
            ec['dateInscription'] = 'sans objet';
            ec['anneeInscription'] = 'sans objet';

            /* // TODO accessible > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            if (result.accessible) {
              ec['accessible'] = result.accessible;
            }
            else {
            ec['accessible'] = 'NR';*/

            /*// TODO langue > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            if (result.langues) {
                ec['langue'] = result.langues.map(elt => elt).join(" / ");
            } else {
                ec['langue'] = 'NR';
            }*/

            // ecolesDoctorale > répétable > nom facultatif / ppn facultatif
            if (result.ecolesDoctorale == null || result.ecolesDoctorale == '') {
                ec['ecoleDoctoraleN'] = 'NR';
                ec['ecoleDoctoralePpn'] = 'NR';
            } else {
                ec['ecoleDoctoraleN'] =  result.ecolesDoctorale.map(elt => {
                    if (elt.nom == null || elt.nom =='') { return 'NR'}
                    else { return elt.nom}
                }).join(" / ");
                ec['ecoleDoctoralePpn'] = result.ecolesDoctorale.map(elt => {
                    if (elt.ppn == null || elt.ppn =='') { return 'NR'}
                    else { return elt.ppn}
                }).join(" / ")
            }

            //  Pour la consultation des theses soumises à identification
            if (ec['Shib-Identity-Provider']) {
                logger.info('IDP => '+ec['Shib-Identity-Provider']);
                var etab = list_idp.results.bindings.find(elt => elt.idpRenater.value === ec['Shib-Identity-Provider']);
                //logger.info('Etab trouve => '+util.inspect(etab, {showHidden: false, depth: null, colors: true}));

                if (etab) {
                    ec['idp_etab_nom'] = etab.etabLabel.value;
                    ec['idp_etab_ppn'] = etab.ppn.value;
                    ec['idp_etab_code_court'] = etab.codeEtab.value;
                    //logger.info('Ok pour : ' + etab.etabLabel.value);
                }
                else {
                    ec['idp_etab_nom'] = "Non trouvé";
                    ec['idp_etab_ppn'] = "Non trouvé";
                    ec['idp_etab_code_court'] = "Non trouvé";
                }
            }
        }
    }

    /**
     * Request metadata from ThesesFr API for given IDs
     * @param {Array} unitids the ids to query
     */
    function query(unitids) {
        report.inc('thesesfr', 'thesesfr-queries');

        const subQueries = [];
        const nnts   = [];
        const numSujets  = [];
        const ppns  = [];

        unitids.forEach(id => {
            /^(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)$/i.test(id) ? nnts.push(id) : /^(s[0-9]+)$/i.test(id) ? numSujets.push(id) : ppns.push(id);
        });

        if (nnts.length > 0) {
            subQueries.push(`nnt:(${nnts.join(' OR ')})`);
        }

        if (numSujets.length > 0) {
            subQueries.push(`numSujet:("${numSujets.join('" OR "')}")`);
        }

        //ACT TODO : traiter les PPN
        const query = `?nombre=200&q=${subQueries.join(' OR ')}`;
        logger.info(' query ==> ' + query);

        const userAgent = 'ezPAARSE (https://readmetrics.org; mailto:ezteam@couperin.org)';
        //const userAgent = 'toto';

        return new Promise((resolve, reject) => {
            const options = {
                method: 'GET',
                json: true,
                headers: {
                    'User-Agent': userAgent
                },
                uri: `${baseUrl}${query}`
            };

            request(options, (err, response, result) => {
                if (err) {
                    report.inc('thesesfr', 'thesesfr-query-fails');
                    return reject(err);
                }

                if (response.statusCode === 404) {
                    return resolve({});
                }

                if (response.statusCode !== 200 && response.statusCode !== 304) {
                    report.inc('thesesfr', 'thesesfr-query-fails');
                    return reject(new Error(`${response.statusCode} ${response.statusMessage}`));
                }

                if (!Array.isArray(result && result.theses)) {
                    report.inc('thesesfr', 'thesesfr-query-fails');
                    return reject(new Error('invalid response'));
                }

                return resolve(result.theses);
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
