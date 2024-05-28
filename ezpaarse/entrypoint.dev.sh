#!/bin/sh

cp -R /tmp/thesesfr middlewares/

./bin/env;
cd middlewares
npm install --no-save -q --unsafe-perm