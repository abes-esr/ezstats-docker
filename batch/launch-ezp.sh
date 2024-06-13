#!/bin/bash
PATH=/opt/ezpaarse/bin:/opt/ezpaarse/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:/usr/local/sbin:$PATH
NODE_ENV=production

cd /home/node
ezp bulk -r -v logtheses/data/thesesfr/logs/ logtheses/data/thesesfr/results/ \
                -h ezstats-ezpaarse:59599 \
                -H "Force-Parser: thesesfr" \
                -H "filter-platforms: thesesfr,,thesesfr-persons" \
                -H "ezPAARSE-Middlewares: thesesfr,thesesfr-persons" \
                -H "Output-Fields: +etabSoutenanceN,+etabSoutenancePpn,+personneNom,+personnePrenom" \
                -H "Log-Format-apache: %h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}<.*>\" \"%{Shib-Identity-Provider}i\" \"%{eppn}i\" \"%{primary-affiliation}i\" \"%{supannEtablissement}i\""

