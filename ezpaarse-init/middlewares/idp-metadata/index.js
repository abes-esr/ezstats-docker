"use strict";

const request = require("request");
const { bufferedProcess, wait } = require("../utils.js");
const xmlMapping = require("xml-mapping");
const path = require("path");
const fs = require("fs");

module.exports = async function () {
    const logger = this.logger;
    const report = this.report;
    const req = this.request;

    logger.info("Initializing ABES idp-metadata middleware");

    // Maximum number of Theses or Persons to query
    const packetSize = parseInt(req.header("idp-metadata-packet-size")) || 100; // Default: 100
    // Minimum number of ECs to keep before resolving them
    const bufferSize = parseInt(req.header("idp-metadata-buffer-size")) || 1000; // Default: 1000

    //Mise en place du cache
    const cacheFileName = "idp-metadata.json";
    const cacheFilePath = path.resolve(__dirname, cacheFileName);
    const cacheRefreshTime =
        parseInt(req.header("idp-metadata-cache-refresh-time")) || 60 * 60 * 24; // Default: 1 day

    logger.info(`Cache refresh set at ${cacheRefreshTime} seconds.`);

    report.set("idp-metadata", "idp-metadata-queries", 0);
    report.set("idp-metadata", "idp-metadata-query-fails", 0);
    report.set("idp-metadata", "idp-metadata-cache-fails", 0);

    /**
     * Try to read the content of a JSON file
     * @param {string} filePath
     * @returns
     */
    function getJSONFileContent(filePath) {
        try {
            const buffer = fs.readFileSync(filePath, { encodage: "utf8" });
            const content = buffer.toString("utf-8");
            return JSON.parse(content);
        } catch (error) {
            logger.error(`Erreur au chargement du fichier ${filePath}`);
            throw error;
        }
    }

    /**
     * Try to write new content in a JSON file,
     * otherwise restore the old content
     * @param {string} filePath
     * @param {Object} content
     * @returns
     */
    function setJSONFileContent(filePath, content) {
        const oldContent = getJSONFileContent(filePath);
        try {
            return fs.writeFileSync(filePath, JSON.stringify(content));
        } catch (error) {
            fs.writeFileSync(filePath, JSON.stringify(oldContent));
            logger.error(`Erreur à l'écriture du fichier ${filePath}`);
            throw error;
        }
    }

    /**
     * Returns if a file was modified more than a day ago.
     * @param {string} filePath
     * @returns
     */
    function isFileFresh(filePath) {
        try {
            const fileStats = fs.statSync(filePath);
            const lastModifiedDate = fileStats.mtime;
            const lastModifiedAgo = (new Date().getTime() - lastModifiedDate) / 1000; // in seconds
            const isFresh = lastModifiedAgo <= cacheRefreshTime;
            logger.info(
                `File updated ${lastModifiedAgo} seconds ago. File ${
                    isFresh ? "valid" : "invalid"
                }.`
            );
            return isFresh; // 24 hours
        } catch {
            return false;
        }
    }

    /**
     * Returns the XML datas from the IDP Renater
     * using cache or API
     */
    async function getIDPRenaterMetadata() {
        if (isFileFresh(cacheFilePath)) {
            logger.info("Récupération du cache des données de Renater.");
            return getJSONFileContent(cacheFilePath);
        }
        const requestConfig = {
            method: "GET",
            uri: `https://pub.federation.renater.fr/metadata/renater/main/main-idps-renater-metadata.xml`,
        };

        logger.info("Récupération des données Renater par l'API.");

        return new Promise((resolve) => {
            request(requestConfig, (err, response, result) => {
                if (err || response.statusCode !== 200) {
                    logger.error("Erreur de récupération par l'API Renater.");
                    logger.info("Récupération du cache des données de Renater.");
                    resolve(getJSONFileContent(cacheFilePath));
                }
                try {
                    logger.info("Mise à jour des données en cache de Renater.");
                    setJSONFileContent(cacheFilePath, xmlMapping.tojson(result));
                } catch (e) {
                    logger.error(e.message);
                } finally {
                    logger.info("Récupération du cache des données de Renater.");
                    resolve(getJSONFileContent(cacheFilePath));
                }
            });
        });
    }

    const idpMetadata = await getIDPRenaterMetadata();

    /**
     * Enrich the current EC with the list_idp
     * @param {Object} ec
     */
    function enrichEc(ec) {
        if (ec["Shib-Identity-Provider"]) {
            logger.info(
                `Tentative de recherche du libellé d'IDP ${ec["Shib-Identity-Provider"]} pour l'EC ${ec.unitid}`
            );
            const etab = idpMetadata.md$EntitiesDescriptor.md$EntityDescriptor.find(
                (entityDescriptor) =>
                    entityDescriptor.entityID === ec["Shib-Identity-Provider"]
            );
            const info = etab.md$IDPSSODescriptor.md$Extensions.mdui$UIInfo;
            ec.libelle_idp = info.mdui$DisplayName.find(
                (displayName) => displayName.xml$lang === "fr"
            )?.$t;
        }
        if (!ec.libelle_idp) {
            ec.libelle_idp = "sans objet";
        }
    }

    return bufferedProcess(this, {
        packetSize,
        bufferSize,
        filter: (ec) => !!ec?.unitid,
        onPacket: ({ ecs }) => {
            for (const [ec, done] of ecs) {
                enrichEc(ec);
                done();
            }
        },
    });
};
