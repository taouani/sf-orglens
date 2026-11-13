"""Counts references of a run that name something the files of the codebase do not define.

    python3 unchecked-names.py <folder of the codebase> <result of run-corpus.ts as JSON>

The resolver of the trial checks no field name against the fields a project defines, and it knows no child
relationship of a standard object. This script counts what follows from that. It reads the field files under
every `objects` folder of the codebase and the references of one run.
"""
import json
import os
import re
import sys
from collections import Counter

root, result = sys.argv[1], sys.argv[2]
defined = {}
for folder, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d != 'node_modules' and not d.startswith('.')]
    parts = folder.replace(os.sep, '/').split('/')
    if len(parts) >= 3 and parts[-1] == 'fields' and parts[-3] == 'objects':
        fields = defined.setdefault(parts[-2].lower(), set())
        for name in files:
            if name.endswith('.field-meta.xml'):
                fields.add(name[: -len('.field-meta.xml')].lower())

# Child relationships of standard objects that code often names. The list is not complete.
CHILDREN = set(
    'contacts opportunities cases accounts tasks events attachments notes histories opportunitylineitems '
    'opportunitycontactroles campaignmembers childaccounts feeds shares contentdocumentlinks '
    'accountcontactrelations orderitems assets contracts orders users groupmembers permissionsetassignments '
    'quotelineitems pricebookentries activityhistories opentasks notesandattachments processinstances '
    'emailmessages casecomments accountteammembers opportunityteammembers leads contentversions'.split()
)
PACKAGED = re.compile(r'^[a-z0-9]+__\w+__c$')

references = json.load(open(result))['references']
to_field = [r for r in references if r['to'].startswith('CustomField:')]
children = Counter()
described = undefined = packaged = guessed = 0
tiers = Counter()
for found in to_field:
    target, field = found['to'][len('CustomField:'):].split('.', 1)
    if field in CHILDREN and not field.endswith('__c'):
        children[found['tier']] += 1
    if not field.endswith('__c') or target not in defined:
        continue
    described += 1
    if field in defined[target]:
        continue
    undefined += 1
    tiers[found['tier']] += 1
    if PACKAGED.match(field):
        packaged += 1
    if found['match'].lower().endswith('__r'):
        guessed += 1

print('references', len(references), 'of them to a field', len(to_field))
print('to a child relationship of a standard object, taken for a field:', sum(children.values()), dict(children))
print('to a custom field of an object that has field files in the codebase:', described)
print('  of them, to a field that no file defines:', undefined, dict(tiers))
print('    of them, the name has the prefix of a package:', packaged)
print('    of them, the name has no prefix:', undefined - packaged)
print('    of them, the word in the code is a relationship (__r) and the field is guessed from it:', guessed)
