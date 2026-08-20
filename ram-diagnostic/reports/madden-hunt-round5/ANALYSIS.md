# Madden hunt round 5 - analysis (2026-08-20)

Session: 2 rounds, 7-9 then 14-10. targetedDumps captured 24 objects per
round BUT dumped the first N *references* to each vtable value - which are
object pools, vtable directories (0x527A8FC0: consecutive module pointers)
and stale instances, never the ~26 score-holding ones. No score visible in
any dump; no strings.

Structural finding: 0xAB58298 instances carry the 0xE88ACD8 vtable value at
+8 - the two prime types are a linked pair (analogue of CFB27's team/display
object split).

Fix (v1.4.70): dumps now happen AT MATCH TIME inside the hunt - only
instances of the four candidate types that hold the live score this instant
are dumped (0x140 bytes + pointed-at strings). One more tester zip gives
the layout.
