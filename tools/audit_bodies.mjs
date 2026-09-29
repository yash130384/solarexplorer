#!/usr/bin/env node
/**
 * Prueft bodies.json auf Datenqualitaet fuer die Performance-Arbeit.
 *
 * Einmaliger Diagnose-Lauf (Ticket 14), kein Produktivcode.
 *
 * usage: node tools/audit_bodies.mjs
 */
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("src/data/bodies.json", "utf8"));
const bodies = raw.bodies;
const facts = JSON.parse(readFileSync("src/data/facts.json", "utf8")).bodies ?? {};

const zeroRadius = bodies.filter((b) => !(Number(b.radiusKm) > 0));
const zeroAxis = bodies.filter((b) => !(Number(b.semiMajorAxisKm) > 0));
const badEcc = bodies.filter(
  (b) => !(Number(b.eccentricity) >= 0) || Number(b.eccentricity) >= 1,
);
const noFacts = bodies.filter((b) => facts[b.id] === undefined);

const byType = {};
for (const b of bodies) byType[b.type] = (byType[b.type] ?? 0) + 1;

console.log("Koerper gesamt:", bodies.length);
console.log("Nach Typ:", JSON.stringify(byType));
console.log("facts-Eintraege:", Object.keys(facts).length);
console.log("radiusKm <= 0:", zeroRadius.length, zeroRadius.slice(0, 20).map((b) => b.id));
console.log("semiMajorAxisKm <= 0:", zeroAxis.length, zeroAxis.slice(0, 20).map((b) => b.id));
console.log("eccentricity kaputt:", badEcc.length, badEcc.slice(0, 20).map((b) => `${b.id}=${b.eccentricity}`));
console.log("ohne Kindtext:", noFacts.length, noFacts.slice(0, 10).map((b) => b.id));
