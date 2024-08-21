#!/usr/bin/env node

'use strict';
const Parser = require('../.lib/parser.js');

/**
 * Recognizes the accesses to the platform Theses.fr
 * @param  {Object} parsedUrl an object representing the URL to analyze
 *                            main attributes: pathname, query, hostname
 * @param  {Object} ec        an object representing the EC whose URL is being analyzed
 * @return {Object} the result
 */
module.exports = new Parser(function analyseEC(parsedUrl, ec) {
  let result = {};
  let path = parsedUrl.pathname;
  // uncomment this line if you need parameters
  // let param = parsedUrl.query || {};

  // use console.error for debuging
   //console.error(parsedUrl);

const regex1 = /\/api\/v1\/personnes\/personne\/([0-9]{8}[0-9X])/ig;
const regex3 = /\/api\/v1\/theses\/organisme\/([0-9]{8}[0-9X])/ig;
const regex2 = /\/api\/v1\/theses\/these\/(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)/ig;

const regex4 = /\/api\/v1\/document\/(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)/ig;
const regex5 = /\/api\/v1\/document\/protected\/(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)/ig;


  let match;

 if ((match = regex5.exec(path)) !== null) {
    // /api/v1/document/protected/2014PA070043  Accès au PDF d’une thèse PHD_THESIS sur l’intranet national
    result.rtype = 'PHD_THESIS';
    result.mime = 'PDF';
    result.unitid = match[1];
    result.publication_date = match[2];
    result.institution_code = match[3];

  }

else if ((match = /^\/(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)\/document$/i.exec(path)) !== null) {
    // https://theses.fr/2020EMAC0007/document Accès au PDF d’une thèse soutenue PHD_THESIS disponible en ligne
    result.rtype = 'PHD_THESIS';
    result.mime = 'PDF';
    result.unitid = match[1];
    result.publication_date = match[2];
    result.institution_code = match[3];
  }

else if ((match = regex4.exec(path)) !== null) {
    // /api/v1/document/2020EMAC0007 Accès au PDF d’une thèse soutenue PHD_THESIS disponible en ligne
    result.rtype = 'PHD_THESIS';
    result.mime = 'PDF';
    result.unitid = match[1];
    result.publication_date = match[2];
    result.institution_code = match[3];

  }

else if ((match = regex1.exec(path)) !== null) {
    // BIO person JSON
    result.rtype = 'RECORD';
    result.mime = 'JSON';
    result.unitid = match[1];
    result.ppn = match[1];

  } else if ((match = regex3.exec(path)) !== null) {
    // BIO organism JSON
    result.rtype = 'RECORD';
    result.mime = 'JSON';
    result.unitid = match[1];
    result.ppn = match[1];

  } else if ((match = /^\/([0-9]{8}[0-9X])$/i.exec(path)) !== null) {
    // /258987731 BIO HTML undeterminable person or organism
    result.rtype = 'RECORD';
    result.mime = 'HTML';
    result.unitid = match[1];
    result.ppn = match[1];

  } else if ((match = /^\/(s[0-9]+)$/i.exec(path)) !== null) {
    // /s366354 ABStract notice d’une thèse en préparation
    result.rtype = 'ABS';
    result.mime = 'HTML';
    result.unitid = match[1];

  } else if ((match = regex2.exec(path)) !== null) {
    // ABStract notice d’une thèse soutenue JSON
    result.rtype = 'ABS';
    result.mime = 'JSON';
    result.unitid = match[1];
    result.publication_date = match[2];
    result.institution_code = match[3];

  } else if ((match = /^\/(([0-9]{4})([a-z]{2}[0-9a-z]{2})[0-9a-z]+)$/i.exec(path)) !== null) {
    // /2023UPASP097 ABStract notice d’une thèse soutenue HTML
    result.rtype = 'ABS';
    result.mime = 'HTML';
    result.unitid = match[1];
    result.publication_date = match[2];
    result.institution_code = match[3];
  }



  return result;
});
