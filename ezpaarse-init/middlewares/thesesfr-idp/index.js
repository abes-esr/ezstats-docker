'use strict';

const fs = require('fs');
const path = require('path');
const request = require('request');

//Pour utiliser util.inspect
//const util = require('util');

/**
 * Mapping entre l'uri de l'IDP Renater (Shib-Identity-Provider) et la base du référentiel des établissements Abes (Movies)
 * Afin d'ajouter le PPN, le Code court et le Nom de l'établissement correspondant
 *
 * Url du web service du référentiel dans Movies (accès interne Abes)
 * https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_idp.json
 *
 * Si l'url n'est pas accessible, le middleware utilisera la copie du mapping list.json
 *
 */
module.exports = function () {
  const logger = this.logger;
  let list;

  if (this.job.outputFields.added.indexOf('idp_etab_ppn') === -1) {
    this.job.outputFields.added.push('idp_etab_ppn');
  }
  if (this.job.outputFields.added.indexOf('idp_etab_nom') === -1) {
    this.job.outputFields.added.push('idp_etab_nom');
  }
  if (this.job.outputFields.added.indexOf('idp_etab_code_court') === -1) {
    this.job.outputFields.added.push('idp_etab_code_court');
  }
  logger.info('Debut de thesesfr-idp');

  return new Promise((resolve, reject) => {

    //Chargement du mapping par appel au web service Movies
    const options = {
      method: 'GET',
      json: true,
      uri: `https://movies.abes.fr/api-git/abes-esr/movies-api/subdir/v1/TH_liste_etabs_idp.json`
    };

    request(options, (err, response, result) => {

      //Si erreur, chargement du fichier list.json, a la place
      if (err || response.statusCode !== 200) {
        chargeFichier();
      };

      if (!err && response.statusCode == 200) {
        if (Array.isArray(result.results.bindings)) {
          list = result;
          logger.info('Chargement du mapping par web service OK');
        }
        else {
          //Si erreur, chargement du fichier list.json, a la place
          chargeFichier();
        }
      };

      resolve(process);
    });

  });

  //Chargement du mapping par fichier list.json
  function chargeFichier(){
    fs.readFile(path.resolve(__dirname, 'list.json'), 'utf8', (err, content) => {
      if (err) {
        return reject(err);
      }

      try {
        list = JSON.parse(content);
        logger.info('Erreur chargement du mapping par web service. Chargement par le fichier list.json OK');
      } catch (e) {
        return reject(e);
      }
    });
  }

  function process(ec, next) {

    if (!ec) { return next(); }

    if (ec['Shib-Identity-Provider']) {
      logger.info('IDP => '+ec['Shib-Identity-Provider']);
      var etab = list.results.bindings.find(elt => elt.idpRenater.value === ec['Shib-Identity-Provider']);
      //logger.info('Etab trouve => '+util.inspect(etab, {showHidden: false, depth: null, colors: true}));

      if (etab) {
        ec['idp_etab_nom'] = etab.etabLabel.value;
        ec['idp_etab_ppn'] = etab.ppn.value;
        ec['idp_etab_code_court'] = etab.codeEtab.value;
        //logger.info('Ok pour : ' + etab.etabLabel.value);
      }
    }

    next();
  }
};
