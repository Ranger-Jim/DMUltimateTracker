// test-parse.ts
//
// This file was written with assistance from AI as a means to help me learn.
// 
// This script is our first real test: load the actual 5etools bestiary file,
// run every monster through the schema, and report what passed and what
// didn't. Run it with: npx ts-node src/test-parse.ts

import fs from "fs";
// Above brings in Node's built-in FIle System tools.
// It's how we read files off disk in Node (there's no "open()" like Python -
// this is the node equivalent.)

import { MonsterSchema } from "./monster-schema";
// This imports the schema we just built from the other file. Note there's
// no ".ts" on the end - Typescript figures out the file extension itself.

// -------------------------------------
// STEP 1: Read the file off disk
// -------------------------------------

// "process.argv" in Node's list of command-line arguments. Index 0 is always
// the path to node itself, index 1 is always the path to this script,
// so index 2 onward is whatever YOU types after the script name.

const filenameArg = process.argv[2];

const filename = filenameArg ?? "bestiary-xmm.json";

console.log(`Reading file: ./data/${filename}\n`);

// fs.readFileSync reads a file and hands back its raw text content.
// "utf-8" tells it to treat the bytes as normal text, not binary data.
const rawText = fs.readFileSync(`./data/${filename}`, "utf-8");

// JSON.parse turns that raw text into a real JavaScript object we can use.
// At this point, TypeScript has no idea what shape this object is --
// it's typed as "any," meaning "could be anything". That's exactly the
// problem Zod is about to solve for us.
const rawData = JSON.parse(rawText);

// -------------------------------------
// STEP 2: Unwrap the top-level "monster" key
// -------------------------------------

// Remember: the whole file is wrapped like { "monster": [ {...}, {...} ] }.
// rawData.monster grabs just that inner array.
const monsterList = rawData.monster;

console.log(`Found ${monsterList.length} monster entries in the file.`);

// ----------------------------------------------------
// STEP 3: Validate every entry
// ----------------------------------------------------

// These are just counters we'll add to as we go.
let successCount = 0;
let failureCount = 0;

// "const failures: string[] = []" declares an empty array that will only
// ever hold strings. TypeScript enforces that - you couldn't accidentally
// push a number into this array later without an error.
const failures: string[] = [];

// A "for...of" loop walks through every item in an array, one at a time.
for (const rawMonster of monsterList) {
  // safeParse check rawMonster against MonsterSChema without throwing
  // an error if it fails. Instead it hands back an object describing
  // what happened.
  const result = MonsterSchema.safeParse(rawMonster);

  if (result.success) {
    // result.data is now the validated, typed monster object.
    successCount++;
  } else {
    // result.error contains the details of what went wrong.
    failureCount++;
    // We record the monster's name (if it has one) plus a short version
    // of the error, so we can look throught he list afterward.
    const name = rawMonster.name ?? "UNKNOWN NAME";
    failures.push(`${name}: ${result.error.issues[0].message} (at ${result.error.issues[0].path.join(".")})`);
  }
}

// ------------------------------------------------------
// STEP 4: Report results
// ------------------------------------------------------

console.log(`\n Passed: ${successCount}`);
console.log(`Failed: ${failureCount}`);

if (failures.length > 0) {
  console.log("First 20 failures:");
  // .slice(0,20) grabs just the first 20 items from the array, so we don't
  // flood the terminal if hundreds fail.
  for (const failureMessage of failures.slice(0, 20)) {
    console.log(" - " + failureMessage);
  }
}