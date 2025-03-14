const co = require('co');
const request = require('request');
const fs = require('fs');
const path = require('path');
const { bufferedProcess, wait } = require('../utils.js');

const cache = ezpaarse.lib('cache')('thesesfr');

const oneDay = 24 * 60 * 60 * 1000;
let lastRefresh = Date.now();
let list_code_court;

module.exports = function () {
    const { logger } = this;
    const { report } = this;
    const req = this.request;

    logger.info('Initializing ABES thesesfr middleware');

    const cacheEnabled = !/^false$/i.test(req.header('thesesfr-cache'));

    logger.info(`Thesesfr cache: ${cacheEnabled ? 'enabled' : 'disabled'}`);

    // Time-to-live of cached documents
    let ttl = parseInt(req.header('thesesfr-ttl'), 10);
    // Minimum wait time before each request (in ms)
    let throttle = parseInt(req.header('thesesfr-throttle'), 10);
    // Maximum enrichment attempts
    let maxTries = parseInt(req.header('thesesfr-max-tries'), 10);
    // Base wait time after a request fails
    let baseWaitTime = parseInt(req.header('thesesfr-base-wait-time'), 10);
    // Maximum number of Theses or Persons to query
    let packetSize = parseInt(req.header('thesesfr-packet-size'), 10);
    // Minimum number of ECs to keep before resolving them
    let bufferSize = parseInt(req.header('thesesfr-buffer-size'), 10);
    // Maximum number of trials before passing the EC in error
    let maxAttempts = parseInt(req.header('thesesfr-max-attempts'), 10);
    // Specify what to send in the `User-Agent` header when querying thesesfr API
    let userAgent = req.header('thesesfr-user-agent');

    if (!userAgent) { userAgent = 'ezPAARSE (https://readmetrics.org; mailto:ezteam@couperin.org)'; }
    if (Number.isNaN(packetSize)) { packetSize = 100; }
    if (Number.isNaN(bufferSize)) { bufferSize = 1000; }
    if (Number.isNaN(baseWaitTime)) { baseWaitTime = 1000; }
    if (Number.isNaN(maxTries)) { maxTries = 5; }
    if (Number.isNaN(throttle)) { throttle = 100; }
    if (Number.isNaN(ttl)) { ttl = 3600 * 24 * 7; }
    if (Number.isNaN(maxAttempts)) { maxAttempts = 5; }

    const baseUrl = 'https://theses.fr/api/v1/theses/recherche/';

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
        filter: (ec) => {
            if (!ec.unitid) {
                return false;
            }
            // Only enrich thesis and thesis record
            if (ec.rtype !== 'PHD_THESIS' && ec.rtype !== 'ABS') {
                return false;
            }
            if (!cacheEnabled) {
                return true;
            }

            return findInCache(ec.unitid).then((cachedDoc) => {
                if (!cachedDoc) {
                    return true;
                }

                if (Object.keys(cachedDoc).length === 0) {
                    logger.debug(`[thesesfr]: unitid: [${ec.unitid}] for rtype: [${ec.rtype}] is not in cache`);
                } else {
                    logger.debug(`[thesesfr]: unitid: [${ec.unitid}] for rtype: [${ec.rtype}] is in cache`);
                    enrichEc(ec, cachedDoc);
                }

                return false;
            });
        },

        onPacket: co.wrap(onPacket),
    });

    /**
     * Load the mapping Code Court from the internal Movies API of Abes
     *
     * https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_code_court.json
     *
     * If the url is not accessible, the middleware will use the copy of the mapping list_code_court.json
     *
     */
    const promiseCodeCourt = new Promise((resolveCodeCourt, rejectCodeCourt) => {

        if (list_code_court && ((Date.now() - lastRefresh) < oneDay)) { return resolveCodeCourt(list_code_court); }

        // Request options
        const optionsCodeCourt = {
            method: 'GET',
            json: true,
            uri: 'https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_code_court.json',
        };

        request(optionsCodeCourt, (errCodeCourt, responseCodeCourt, resultCodeCourt) => {
            // if error, use local file list_code_court.json instead
            if (errCodeCourt || responseCodeCourt.statusCode !== 200 || !Array.isArray(resultCodeCourt.results.bindings)) {
                logger.warn('[thesesfr]: Fail to request list_code_court.json from web service');
                loadMapping('list_code_court.json', resolveCodeCourt, rejectCodeCourt);
                return;
            }

            logger.info('[thesesfr]: Successfully request list_code_court.json from web service');

            lastRefresh = Date.now();
            resolveCodeCourt(resultCodeCourt);
        });
    });

    /**
     * Load the mapping Code Court from the internal Movies API of Abes at the begin of process.
     *
     * @param filename filename of mapping file.
     * @param resolve
     * @param reject
     */
    function loadMapping(filename, resolve, reject) {
        fs.readFile(path.resolve(__dirname, filename), 'utf8', (err, content) => {
            if (err) {
                logger.error(`[thesesfr]: Cannot read [${filename}]`);
                return reject(err);
            }

            try {
                return resolve(JSON.parse(content));
            } catch (e) {
                logger.error(`[thesesfr]: Cannot parse [${content}]`);
                return reject(e);
            }
        });
    }

    return new Promise((resolve, reject) => {
        // Verify cache indices and time-to-live before starting
        cache.checkIndexes(ttl, (err1) => {
            if (err1) {
                logger.error(`[thesesfr]: failed to verify indexes : ${err1}`);
                return reject(new Error('failed to verify indexes for the cache of Thesesfr'));
            }

            return promiseCodeCourt
                .then((result) => {
                    list_code_court = result;
                    resolve(process);
                })
                .catch((err2) => {
                    logger.error(`[thesesfr]: Cannot load mapping ${err2}`);
                    reject(err2);
                });
        });
    });

    /**
     * Process a packet of ECs
     *
     * @param {Array<Object>} ecs
     * @param {Map<String, Set<String>>} groups
     */
    function* onPacket({ ecs }) {
        if (ecs.length === 0) {
            return;
        }

        const unitids = ecs.filter(([ec]) => (ec.rtype === 'PHD_THESIS') || (ec.rtype === 'ABS')).map(([ec]) => ec.unitid);

        let tries = 0;
        let docs;

        while (!docs) {
            tries += 1;
            if (tries > maxAttempts) {
                logger.error(`[thesesfr]: Cannot request thesesfr ${maxAttempts} times in a row`);
                return;
            }

            try {
                docs = yield query(unitids);
            } catch (e) {
                logger.error(`[thesesfr]: Cannot request thesesfr ${e.message}`);
            }

            yield wait(tries === 0 ? throttle : baseWaitTime * 2 ** tries);
        }

        const docResults = new Map(
            docs.filter((doc) => doc && doc.id).map((doc) => [doc.id, doc]),
        );

        for (const [ec, done] of ecs) {
            const { unitid } = ec;
            const doc = docResults.get(unitid);

            try {
                // If we can't find a result for a given ID, we cache an empty document
                yield cacheResult(unitid, doc || {});
            } catch (e) {
                report.inc('thesesfr', 'thesesfr-cache-fails');
            }

            if (doc) {
                logger.debug(`[thesesfr]: ${ec.rtype} doc come from onPacket`);
                enrichEc(ec, doc);
            }

            done();
        }
    }

    /**
     * Enrich an EC using a forged result (absent from query response)
     *
     * @param {Object} ec the EC to be enriched
     */
    function enrichForgedEc(ec) {
        const notFoundLabel = 'NOT_FOUND';

        ec.rtype = 'OTHER';
        ec.nnt = notFoundLabel;
        ec.numSujet = notFoundLabel;
        ec.etabSoutenanceN = notFoundLabel;
        ec.etabSoutenancePpn = notFoundLabel;
        ec.codeCourt = notFoundLabel;
        ec.dateSoutenance = notFoundLabel;
        ec.anneeSoutenance = notFoundLabel;
        ec.dateInscription = notFoundLabel;
        ec.anneeInscription = notFoundLabel;
        ec.statut = notFoundLabel;
        ec.discipline = notFoundLabel;
        ec.ecoleDoctoraleN = notFoundLabel;
        ec.ecoleDoctoralePpn = notFoundLabel;
        ec.partenaireRechercheN = notFoundLabel;
        ec.partenaireRecherchePpn = notFoundLabel;
        ec.auteurN = notFoundLabel;
        ec.auteurPpn = notFoundLabel;
        ec.directeurN = notFoundLabel;
        ec.directeurPpn = notFoundLabel;
        ec.presidentN = notFoundLabel;
        ec.presidentPpn = notFoundLabel;
        ec.rapporteursN = notFoundLabel;
        ec.rapporteursPpn = notFoundLabel;
        ec.membresN = notFoundLabel;
        ec.membresPpn = notFoundLabel;
        ec.personneN = notFoundLabel;
        ec.personnePpn = notFoundLabel;
        ec.organismeN = notFoundLabel;
        ec.organismePpn = notFoundLabel;
        ec.idp_etab_nom = notFoundLabel;
        ec.idp_etab_ppn = notFoundLabel;
        ec.idp_etab_code_court = notFoundLabel;
        ec.platform_name = notFoundLabel;
        ec.publication_title = notFoundLabel;
    }

    /**
     * Enrich an EC using the result of a query
     *
     * @param {Object} ec the EC to be enriched
     * @param {Object} result the document from result of query used to enrich the EC
     */

    function enrichEc(ec, result) {
        // If doc is not available on API thesefr
        if (result.missing) {
            logger.debug(`[thesefr]: ${result.id} for ${ec.rtype} will be forged`);
            enrichForgedEc(ec, result);
            return;
        }

        // #region common
        if (result.etabSoutenanceN) { ec.etabSoutenanceN = result.etabSoutenanceN; }
        if (result.etabSoutenancePpn) {
            ec.etabSoutenancePpn = result.etabSoutenancePpn;
        } else {
            ec.etabSoutenancePpn = 'NR';
        }

        const eltCodeCourt = list_code_court.results.bindings.find((elt) => elt.ppn.value === result.etabSoutenancePpn);
        if (eltCodeCourt) { ec.codeCourt = eltCodeCourt.codeCourt.value; }
        if (result.status) { ec.statut = result.status; }

        // TODO source > obligatoire > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
        // if (result.source) { ec['statut'] = result.source; }

        // TODO domaine > obligatoire  > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
        // if (result.domaine) { ec['domaine'] = result.domaine; }

        if (result.discipline) { ec.discipline = result.discipline; }

        // partenairesDeRecherche > répétable > nom + prenom facultatif / ppn facultatif
        if (!result.partenairesDeRecherche || result.partenairesDeRecherche.length === 0) {
            ec.partenaireRechercheN = 'NR';
            ec.partenaireRecherchePpn = 'NR';
        } else {
            ec.partenaireRechercheN = result.partenairesDeRecherche.map((elt) => {
                if (typeof elt.nom === 'string' && elt.nom.length > 0) {
                    return elt.nom
                }
                return 'NR';
            }).join(' / ');

            ec.partenaireRecherchePpn = result.partenairesDeRecherche.map((elt) => {
                if (typeof elt.ppn === 'string' && elt.ppn.length > 0) {
                    return elt.ppn;
                }
                return 'NR';
            }).join(' / ');
        }

        // TODO coTutelleN, coTutellePpn > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)

        if (result.auteurs) {
            ec.auteurN = result.auteurs
                .map((elt) => `${elt.nom} ${elt.prenom}`)
                .join(' / ');
            ec.auteurPpn = result.auteurs
                .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                .join(' / ');
        }

        if (result.directeurs) {
            ec.directeurN = result.directeurs
                .map((elt) => `${elt.nom} ${elt.prenom}`)
                .join(' / ');
            ec.directeurPpn = result.directeurs
                .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                .join(' / ');
        }

        if (result.president.nom && result.president.prenom) {
            ec.presidentN = `${result.president.nom} ${result.president.prenom}`;
        } else {
            ec.presidentN = 'NR';
        }
        if (result.president.ppn) {
            ec.presidentPpn = result.president.ppn;
        } else {
            ec.presidentPpn = 'NR';
        }

        if (!result.rapporteurs || result.rapporteurs.length === 0) {
            ec.rapporteursN = 'NR';
            ec.rapporteursPpn = 'NR';
        } else {
            ec.rapporteursN = result.rapporteurs
                .map((elt) => (elt.nom ? `${elt.nom} ${elt.prenom}` : 'NR'))
                .join(' / ');

            ec.rapporteursPpn = result.rapporteurs
                .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                .join(' / ');
        }

        if (!result.examinateurs || result.examinateurs.length === 0) {
            ec.membresN = 'NR';
            ec.membresPpn = 'NR';
        } else {
            ec.membresN = result.examinateurs
                .map((elt) => (elt.nom ? `${elt.nom} ${elt.prenom}` : 'NR'))
                .join(' / ');
            ec.membresPpn = result.examinateurs
                .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                .join(' / ');
        }

        // set 'sans objet' for thesis and subject thesis + access to thesis document
        ec.personneN = 'sans objet';
        ec.personnePpn = 'sans objet';
        ec.organismeN = 'sans objet';
        ec.organismePpn = 'sans objet';
        // set 'sans objet' for thesis and subject thesis + access to thesis document without authentification
        ec.idp_etab_nom = 'sans objet';
        ec.idp_etab_ppn = 'sans objet';
        ec.idp_etab_code_court = 'sans objet';

        // For BilioMap display of the codeCourt of the institution in platform_name which allows the filter by institution + in the reserved field "libelé de l'étab complet -  discipline"
        ec.platform_name = ec.codeCourt;
        // FIXME Put HTML in bibliomap
        ec.publication_title = `${ec.etabSoutenanceN}<br/>${ec.discipline}`;
        // #endregion common

        // #region 'enCours'
        if (result.status === 'enCours') {
            // NNT facultatif
            if (result.nnt) {
                ec.nnt = result.nnt;
            } else {
                ec.nnt = 'NR';
            }

            if (result.id) {
                ec.numSujet = result.id;
            }

            // TODO doiThese > sans objet > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            // ec['doiThese'] = 'sans objet';

            if (result.dateSoutenance) {
                ec.dateSoutenance = result.dateSoutenance;
                ec.anneeSoutenance = result.dateSoutenance.substring(6, 10);
            } else {
                ec.dateSoutenance = 'NR';
                ec.anneeSoutenance = 'NR';
            }

            // dateInscription et anneInscription > obligatoire
            if (result.datePremiereInscriptionDoctorat) {
                ec.dateInscription = result.datePremiereInscriptionDoctorat;
                ec.anneeInscription = result.datePremiereInscriptionDoctorat.substring(6, 10);
            }

            // TODO accessible > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            // ec['accessible'] = 'sans objet';

            // TODO langue > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            // ec['langue'] = 'sans objet';

            // ecolesDoctorale > répétable > nom obligatoire / ppn facultatif
            if (result.ecolesDoctorale) {
                ec.ecoleDoctoraleN = result.ecolesDoctorale
                    .map((elt) => elt.nom)
                    .join(' / ');

                ec.ecoleDoctoralePpn = result.ecolesDoctorale
                    .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                    .join(' / ');
            }
        }
        // #endregion 'enCours'

        // #region 'soutenue'
        if (result.status === 'soutenue') {
            if (result.nnt) {
                ec.nnt = result.nnt;
            }

            ec.numSujet = 'sans objet';

            // TODO doiThese > à masquer tant que non présent dans l'API theses > supprimé provisoirement du header (champs pour la sortie)
            // if (result.doi) {
            //   ec.doiThese = result.doi;
            // } else {
            //   ec.doiThese = 'NR';
            // }

            // TODO Code court de l'étab de soutenance est obligatoire il doit être récupéré via API movies
            // TODO en attendant rempli par le tronc commune 'sans objet'

            // dateSoutenance et anneSoutenance > obligatoire
            if (result.dateSoutenance) {
                ec.dateSoutenance = result.dateSoutenance;
                ec.anneeSoutenance = result.dateSoutenance.substring(6, 10);
            }

            ec.dateInscription = 'sans objet';
            ec.anneeInscription = 'sans objet';

            // TODO accessible est à masquer tant que non présent dans l'API theses. à supprimer provisoirement du header (champs pour la sortie)
            // if (result.accessible) {
            //   ec.accessible = result.accessible;
            // } else {
            //   ec.accessible = 'NR';
            // }

            // TODO langue est à masquer tant que non présent dans l'API theses. à supprimé provisoirement du header (champs pour la sortie)
            // if (result.langues) {
            //   ec.langue = result.langues.map((elt) => elt).join(' / ');
            // } else {
            //   ec.langue = 'NR';
            // }

            if (!result.ecolesDoctorale  || result.ecolesDoctorale.length === 0) {
                ec.ecoleDoctoraleN = 'NR';
                ec.ecoleDoctoralePpn = 'NR';
            } else {
                ec.ecoleDoctoraleN = result.ecolesDoctorale
                    .map((elt) => (elt.nom ? elt.nom : 'NR'))
                    .join(' / ');

                ec.ecoleDoctoralePpn = result.ecolesDoctorale
                    .map((elt) => (elt.ppn ? elt.ppn : 'NR'))
                    .join(' / ');
            }
        }
        // #endregion 'soutenue'
    }

    /**
     * Request metadata from ThesesFr API for given IDs
     * @param {Array} unitids the ids to query
     */
    function query(unitids) {
        report.inc('thesesfr', 'thesesfr-queries');

        const subQueries = [];
        const nnts = [];
        const numSujets = [];
        const ppns = [];

        unitids.forEach((id) => {
            if (/^(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)$/i.test(id)) {
                nnts.push(id);
            } else if (/^(s[0-9]+)$/i.test(id)) {
                numSujets.push(id);
            } else {
                ppns.push(id);
            }
        });

        if (nnts.length > 0) {
            subQueries.push(`nnt:(${nnts.join(' OR ')})`);
        }

        if (numSujets.length > 0) {
            subQueries.push(`numSujet:("${numSujets.join('" OR "')}")`);
        }

        // TODO : traiter les PPN

        const uniques = new Set(nnts.concat(numSujets));

        const queryParams = {
            nombre: 200,
            q: subQueries.join(' OR '),
        };

        return new Promise((resolve, reject) => {
            const options = {
                method: 'GET',
                json: true,
                headers: {
                    'User-Agent': userAgent,
                },
                uri: baseUrl,
                qs: queryParams,
            };

            const pseudoResponse = new Set();

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

                const uniqueSize = Number(uniques.size);
                const respondedSize = Number(result.totalHits);
                const missingSize = uniqueSize - respondedSize;

                if (missingSize > 0) {
                    const responseIds = result.theses.map((o) => o.id);
                    const responseAPI = new Set(responseIds);

                    const diffSet = new Set([...uniques].filter((x) => !responseAPI.has(x)));

                    for (const value of diffSet.values()) {
                        // create pseudo response that will be add on result.theses[]
                        const pseudoObj = { id: value, missing: true };
                        pseudoObj.id = value;
                        pseudoResponse.add(pseudoObj);
                    }
                }

                return resolve(result.theses.concat([...pseudoResponse]));
            });
        });
    }

    /**
     * Cache an item with a given ID
     *
     * @param {String} id the ID of the item
     * @param {Object} item the item to cache
     */
    function cacheResult(id, item) {
        return new Promise((resolve, reject) => {
            if (!id || !item) {
                resolve();
                return;
            }

            cache.set(id, item, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
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
            if (!identifier) {
                resolve();
                return;
            }

            cache.get(identifier, (err, cachedDoc) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(cachedDoc);
            });
        });
    }
};
