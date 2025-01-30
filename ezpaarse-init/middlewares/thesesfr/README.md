# thesesfr

Fetches thesesfr API from ABES.
This middleware is used only for log from these.fr.

## Enriched fields


| Name | Type | Description |
| --- | --- | --- |
| rtype | String | type de consultation (ABS = notice de thèse vue ; PDF_THESIS = fichier de thèse téléchargé ; BIO = notice de personne vue ; ORGANISME = notice d'organisme vue) |
| nnt | | Numéro National de Thèse |
| numSujet | String | identifiant de la thèse en préparation dans la base STEP |
| etabSoutenanceN | String | nom de l'établissement de soutenance de la thèse |
| etabSoutenancePpn | String | identifiant (PPN) de l'établissement de soutenance de la thèse |
| codeCourt | String | code court de l'établissement de soutenance de la thèse |
| dateSoutenance | String | date de soutenance de la thèse |
| anneeSoutenance | String | année de soutenance de la thèse |
| dateInscription | String | date d'inscription en doctorat |
| anneeInscription | String | année d'inscription en doctorat |
| statut | String | statut de la thèse : soutenue ou en préparation |
| discipline | String | discipline de la thèse |
| ecoleDoctoraleN | String | nom de l'école doctorale liée à la thèse |
| ecoleDoctoralePpn | String | identifiant (PPN) de l'école doctorale liée à la thèse |
| partenaireRechercheN | String | nom du partenaire de recherche (laboratoire, entreprise, équipe de recherche, fondation, etc) |
| partenaireRecherchePpn | String | identifiant (PPN) du partenaire de recherche (laboratoire, entreprise, équipe de recherche, fondation, etc) |
| auteurN | String | nom de l'auteur de la tèse |
| auteurPpn | String | identifiant (PPN) de l'auteur de la thèse |
| directeurN | String | nom du directeur de thèse |
| directeurPpn | String | identifiant (PPN) du directeur de thèse |
| presidentN | String | nom du président du jury |
| presidentPpn | String | identifiant (PPN) du président du jury |
| rapporteursN | String | nom des rapporteurs |
| rapporteursPpn | String | identifiant (PPN) des rapporteurs |
| membresN | String | nom des membres du jury |
| membresPpn | String | identifiant (PPN) des membres du jury |
| personneN | String | nom de la personne quel que soit son rôle (auteur, directeur, membre du jury, rapporteur, président du jury, etc) |
| personnePpn | String | identifiant (PPN) de la personne quel que soit son rôle (auteur, directeur, membre du jury, rapporteur, président du jury, etc) |
| organismeN | String | nom de l'organisme quel que soit son rôle (établissement de soutenance, école doctorale, partenaire de recherche, etc) |
| organismePpn | String | identifiant (PPN) de l'organisme quel que soit son rôle (établissement de soutenance, école doctorale, partenaire de recherche, etc) |
| idp_etab_nom | String | dans les logs Apache : nom de l'établissement de rattachement de l'utilisateur (quand connexion via Renater) |
| idp_etab_ppn | String | dans les logs Apache : identifiant (PPN) de l'établissement de rattachement de l'utilisateur (quand connexion via Renater) |
| idp_etab_code_court | String | dans les logs Apache : code court de l'établissement de rattachement de l'utilisateur (quand connexion via Renater) |
| platform_name | String | nom long de la plateforme d'hébergement de la ressource : theses.fr |
| publication_title | String | titre de la ressource |
| source | String | source des données : STEP, STAR, Sudoc |
| domaine | String | domaine thématique associé à la thèse |
| doiThese | String | DOI attribué à la thèse |
| accessible | String | thèse accessible en ligne : oui ou non | 
| langue | String | langue de rédaction de la thèse | 

## Prerequisites

**You must use thesesfr after filter, parser, deduplicator middleware.**

## Recommendation

This middleware should be used before thesesfr and thesesfr-organisme.

## Headers

+ **thesesfr-ttl** : Lifetime of cached documents, in seconds. Defaults to ``7 days (3600 * 24 * 7)``.
+ **thesesfr-throttle** : Minimum time to wait between queries, in milliseconds. Defaults to ``200``ms.
+ **thesesfr-base-wait-time** : Time to wait before retrying after a query fails, in milliseconds. Defaults to ``1000``ms. This time ``doubles`` after each attempt.
+ **thesesfr-paquet-size** : Maximum number of identifiers to send for query in a single request. Defaults to ``50``.
+ **thesesfr-buffer-size** : Maximum number of memorized access events before sending a request. Defaults to ``1000``.
+ **thesesfr-max-attempts** : Maximum number of trials before passing the EC in error. Defaults to ``5``.
+ **thesesfr-user-agent** : Specify what to send in the `User-Agent` header when querying thesesfr. Defaults to `ezPAARSE (https://readmetrics.org; mailto:ezteam@couperin.org)`.

## How to use

### ezPAARSE admin interface

You can add or remove thesesfr by default to all your enrichments, provided you have added an API key in the config. To do this, go to the middleware section of administration.

![image](./docs/admin-interface.png)

### ezPAARSE process interface

You can use thesesfr for an enrichment process. You just add the middleware

![image](./docs/process-interface.png)

### ezp

You can use thesesfr for an enrichment process with [ezp](https://github.com/ezpaarse-project/node-ezpaarse) like this:

```bash
# enrich with one file
ezp process <path of your file> \
  --host <host of your ezPAARSE instance> \
  --settings <settings-id> \
  --header "ezPAARSE-Middlewares: thesesfr" 
  --out ./result.csv

# enrich with multiples files
ezp bulk <path of your directory> \
  --host <host of your ezPAARSE instance> \
  --settings <settings-id> \
  --header "ezPAARSE-Middlewares: thesesfr" 

```

### curl

You can use thesesfr for an enrichment process with curl like this:

```bash
curl -X POST -v http://localhost:59599 \
  -H "ezPAARSE-Middlewares: thesesfr" \
  -H "Log-Format-Ezproxy: <line format>" \
  -F "file=@<log file path>"

```