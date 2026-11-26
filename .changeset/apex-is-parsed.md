---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis of a snapshot parses the code of every Apex class and trigger. A file that the parser cannot read is the
error `APEX_MALFORMED` of its class or trigger, with the line and the column where the parser stops, and the analysis
is incomplete, so `orglens snapshot` ends with the exit code `5` where it ended with `0`. Nothing else of Apex is read
yet: what a class refers to comes later in this phase. The parser is loaded only by the analysis of a snapshot that
holds Apex, so the other commands do not start slower. A snapshot analysed by an older version keeps its issues until
it is analysed again (`orglens analyse`). Decision record 0083 has the details.
