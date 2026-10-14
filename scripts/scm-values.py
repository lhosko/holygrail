#!/usr/bin/env python3
"""Prints the gateway registration from SCM's Deploy Hybrid values.yaml as KEY=value lines (for gateway.env).

Flat, known layout: imageCredentials[0].username/password and environment.data.PORTKEY_CLIENT_AUTH /
ORGANISATIONS_TO_SYNC. Stdlib only, so no PyYAML. Used by setup.sh; never run it where the output is shown.
"""
import re
import sys

text = open(sys.argv[1]).read()


def get(key):
    m = re.search(r'^\s*-?\s*%s:\s*(.+?)\s*$' % key, text, re.M)
    if not m:
        sys.exit("%s has no %s. Is it the values.yaml from SCM Deploy Hybrid?" % (sys.argv[1], key))
    return m.group(1).strip().strip('"').strip("'")


for env, key in [("REGISTRY_USERNAME", "username"), ("REGISTRY_PASSWORD", "password"),
                 ("PORTKEY_CLIENT_AUTH", "PORTKEY_CLIENT_AUTH"), ("ORGANISATIONS_TO_SYNC", "ORGANISATIONS_TO_SYNC")]:
    print("%s=%s" % (env, get(key)))
