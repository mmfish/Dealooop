// The campaign's cartoon picture: chosen from what the app is about, with its name underneath.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artKind, campaignArt} from '../backend/campaign-art.ts';

test('the object follows what the app is about', () => {
  assert.equal(artKind('LittleMoochi', 'A food-curiosity app for families: kids snap a meal photo.'), 'bowl');
  assert.equal(artKind('StoryNest', 'Learn to read with short stories.'), 'book');
  assert.equal(artKind('SnapShelf', 'Organize your photos.'), 'camera');
  assert.equal(artKind('Dealoop', 'A marketplace for founders and creators.'), 'bubble');
  assert.equal(artKind('ShipKit', 'An API for developers.'), 'laptop');
  assert.equal(artKind('Moodly', 'Track your mood.'), 'box');
});

test('the picture is a self-contained SVG with the app name, escaped', () => {
  const svg = campaignArt('Tom & Jerry\'s <App>', 'A game.');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.includes('Tom &amp; Jerry&apos;s &lt;App&gt;</text>'));
  assert.ok(!/<script|href=/i.test(svg), 'no scripts or links');
  assert.equal(campaignArt('Moodly', 'x'), campaignArt('Moodly', 'x'), 'the same picture every time');
});
