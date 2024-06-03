'use strict';

const co = require('co');
const request = require('request');
const { bufferedProcess, wait } = require('../utils.js');
const cache = ezpaarse.lib('cache')('thesesfr');

module.exports = function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    logger.info('Initializing thesesfr middleware');

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

    let baseUrl = "https://theses.fr/api/v1/theses/recherche/";

    if (isNaN(baseWaitTime)) { baseWaitTime = 10; } //1000
    if (isNaN(maxTries)) { maxTries = 5; }
    if (isNaN(throttle)) { throttle = 10; } //100
    if (isNaN(ttl)) { ttl = 3600 * 24 * 7; }

    if (!cache) {
        const err = new Error('failed to connect to mongodb, cache not available for Thesesfr');
        err.status = 500;
        return err;
    }

    report.set('thesesfr', 'thesesfr-queries', 0);
    report.set('thesesfr', 'thesesfr-query-fails', 0);
    report.set('thesesfr', 'thesesfr-cache-fails', 0);

    const process = bufferedProcess(this, {
        /**
         * Filter ECs that should be enriched
         * @param {Object} ec
         * @returns {Boolean|Promise} true if the EC should be enriched, false otherwise
         */
        filter: ec => {
            if (!ec.unitid) { return false; }
            if (!cacheEnabled) { return true; }

            return findInCache(ec.unitid).then(cachedDoc => {
                if (cachedDoc) {
                    enrichEc(ec, cachedDoc);
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

        const unitids = ecs.map(([ec, done]) => ec.unitid);

        const maxAttempts = 5;
        let tries = 0;
        let docs;

        while (!docs) {
            if (++tries > maxAttempts) {
                const err = new Error(`Failed to query Thesesfr ${maxAttempts} times in a row`);
                return Promise.reject(err);
            }

            try {
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
    function enrichEc(ec, result) {
        const {
            etabSoutenanceN,
            etabSoutenancePpn
        } = result;

        if (etabSoutenanceN) {
            ec['etabSoutenanceN'] = etabSoutenanceN;
        }

        if (etabSoutenancePpn) {
            ec['etabSoutenancePpn'] = etabSoutenancePpn;
        }

        logger.info(' etab Soutenance ==> ' + ec['etabSoutenancePpn'] + ' ' +ec['etabSoutenanceN']);
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
            /^(([0-9]{4})([a-z]{4})[0-9a-z]+)$/i.test(id) ? nnts.push(id) : /^(s[0-9]+)$/i.test(id) ? numSujets.push(id) : ppns.push(id);
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

        return new Promise((resolve, reject) => {
            const options = {
                method: 'GET',
                json: true,
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
