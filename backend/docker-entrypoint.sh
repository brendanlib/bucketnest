#!/bin/sh
set -e
# Apply any pending migrations, then start. Safe to run on every start.
node node_modules/prisma/build/index.js migrate deploy
exec node dist/server.js
