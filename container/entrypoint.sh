#!/bin/sh
set -e

# compose.yaml mounts the company root certificate here when CORP_CA_FILE is set; otherwise it is empty.
if [ -s /certs/corp-ca.crt ]; then
  export NODE_EXTRA_CA_CERTS=/certs/corp-ca.crt
fi

exec node --disable-warning=ExperimentalWarning apps/server/dist/index.js "$@"
