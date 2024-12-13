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
                logger.info('Erreur chargement du mapping par web service : chargement par le fichier '+nomFichier+' OK');
                return resolve(content);
            } catch (e) {
                return reject(e);
            }
        });
    }



    const promiseIdP = new Promise((resolveIdP, rejectIdP) => {

        if (list_idp && ((Date.now() - lastRefresh) < oneDay)) { return resolveIdP(list_idp); }

        logger.info('Rafraichissement du mapping : idp-metadata Renater');

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
                logger.error(`idp-metadata: erreur chargement des mappings : ${err}`);
                return reject(new Error('idp-metadata: erreur chargement des mappings'));
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

    /* ERM header cible
 	# -H "Output-Fields: +nnt, +numSujet, +doiThese, +etabSoutenanceN, +etabSoutenancePpn, +codeCourt, +dateSoutenance, +anneeSoutenance, +dateInscription, +anneeInscription, +statut, +accessible, +source, +discipline, +domaine, +langue, +ecoleDoctoraleN, +ecoleDoctoralePpn, +partenaireRechercheN, +partenaireRecherchePpn, +cotutelleN, +cotutellePpn, +auteurN, +auteurPpn, +directeurN, +directeurPpn, +presidentN, +presidentPpn, +rapporteursN, +rapporteursPpn, +membresN, +membresPpn, +personneN, +personnePpn, +organismeN, +organismePpn, +idp_etab_nom, +idp_etab_ppn, +idp_etab_code_court, +platform_name " \
    */
    function enrichEc(ec) {
        if(ec['Shib-Identity-Provider']) {
            logger.info(`Tentative de recherche du libellé d'IDP ${ec['Shib-Identity-Provider']} pour l'EC ${ec.unitid}`);
            const etab = list_idp.md$EntitiesDescriptor.md$EntityDescriptor.find((entityDescriptor) => entityDescriptor.entityID === ec['Shib-Identity-Provider'])
            const info = etab.md$IDPSSODescriptor.md$Extensions.mdui$UIInfo
            ec.libelle_idp = info.mdui$DisplayName.find((displayName) => displayName.xml$lang === "fr")?.$t;
        }
        if (!ec.libelle_idp) {
            ec.libelle_idp = "sans objet"
        }
    }
};
