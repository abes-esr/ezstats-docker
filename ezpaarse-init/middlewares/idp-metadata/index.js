'use strict';

const co = require('co');
const request = require('request');
const { bufferedProcess, wait } = require('../utils.js');
const xmlMapping = require('xml-mapping')

const oneDay = 24 * 60 * 60 * 1000;
let lastRefresh = Date.now();
let list_idp;

module.exports = function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    logger.info('Initializing ABES idp-metadata middleware');

    // Maximum number of Theses or Persons to query
    let packetSize = parseInt(req.header('idp-metadata-packet-size'));
    // Minimum number of ECs to keep before resolving them
    let bufferSize = parseInt(req.header('idp-metadata-buffer-size'));
    if (isNaN(packetSize)) { packetSize = 100; } //Default : 50
    if (isNaN(bufferSize)) { bufferSize = 1000; } //Default : 1000

    report.set('idp-metadata', 'idp-metadata-queries', 0);
    report.set('idp-metadata', 'idp-metadata-query-fails', 0);
    report.set('idp-metadata', 'idp-metadata-cache-fails', 0);

    const process = bufferedProcess(this, {
        packetSize,
        bufferSize,
        /**
         * Filter ECs that should be enriched
         * @param {Object} ec
         * @returns {Boolean|Promise} true if the EC as an unitid, false otherwise
         */
        filter: ec => !!ec?.unitid,
        onPacket: co.wrap(onPacket)
    });

    //Chargement du mapping par fichier (list_idp.xml)
    function chargeMapping(nomFichier, resolve, reject){
        fs.readFile(path.resolve(__dirname, nomFichier), 'utf8', (err, content) => {
            if (err) {
                return reject(err);
            }

            try {
                logger.info('[idp-metadata]: Fail to request main-idps-renater-metadata.xml from web service : load file '+nomFichier+' OK');
                return resolve(content);
            } catch (e) {
                return reject(e);
            }
        });
    }



    const promiseIdP = new Promise((resolveIdP, rejectIdP) => {

        if (list_idp && ((Date.now() - lastRefresh) < oneDay)) { return resolveIdP(list_idp); }

        logger.info('[idp-metadata]: mapping reload');

        //Chargement du mapping par appel au web service Renater
        const optionsIdP = {
            method: 'GET',
            uri: `https://pub.federation.renater.fr/metadata/renater/main/main-idps-renater-metadata.xml`
        };

        request(optionsIdP, (errIdP, responseIdP, resultIdP) => {
            //Si erreur, chargement du fichier list_idp.xml, a la place
            if (errIdP || responseIdP.statusCode !== 200) {
                chargeMapping('list_idp.xml', resolveIdP, rejectIdP);
            };

            lastRefresh = Date.now();
            //Transformation du fichier de metadonnees XML en JSON
            resolveIdP(xmlMapping.tojson(resultIdP));
        });
    });

    return new Promise(function (resolve, reject) {
        Promise.all([promiseIdP])
            .then((promises) => {
                list_idp = promises[0];
                resolve(process);
            })
            .catch(function(err) {
                logger.error(`[idp-metadata]: fail to load the mapping : ${err}`);
                return reject(new Error('[idp-metadata]: fail to load the mapping'));
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
            enrichEc(ec)
            done();
        }
    }

    /**
     * Enrich an EC using the result of a query
     * @param {Object} ec the EC to be enriched
     * @param {Object} result the document used to enrich the EC
     */
    function enrichEc(ec) {
        if(ec['Shib-Identity-Provider']) {
            logger.info(`[idp-metadata]: try to find an IDP label for ${ec['Shib-Identity-Provider']} , to the EC ${ec.unitid}`);
            const etab = list_idp.md$EntitiesDescriptor.md$EntityDescriptor.find((entityDescriptor) => entityDescriptor.entityID === ec['Shib-Identity-Provider']);
            ec.libelle_idp = "";
            if (etab) {
                const info = etab.md$IDPSSODescriptor.md$Extensions.mdui$UIInfo;
                ec.libelle_idp = info.mdui$DisplayName.find((displayName) => displayName.xml$lang === "fr")?.$t;
            }
        }
        if (!ec.libelle_idp) {
            ec.libelle_idp = "sans objet"
        }
    }
};
