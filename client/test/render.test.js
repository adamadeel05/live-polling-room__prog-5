import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const clientDirectory = fileURLToPath(new URL('../', import.meta.url));
let vite;

before(async () => {
  // Transform the real JSX through Vite without opening an HTTP or HMR port.
  vite = await createServer({
    root: clientDirectory,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
});

after(async () => {
  await vite?.close();
});

async function renderComponent(name, props = {}) {
  const { default: Component } = await vite.ssrLoadModule(`/src/components/${name}.jsx`);
  return renderToStaticMarkup(createElement(Component, props));
}

function plainText(markup) {
  return markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('SSR homepage renders links to create and join a poll', async () => {
  const markup = await renderComponent('HomePage');
  assert.match(markup, /<a\b[^>]*href="#\/create"[^>]*>[\s\S]*?Create poll/);
  assert.match(markup, /<a\b[^>]*href="#\/join"[^>]*>[\s\S]*?Join poll/);
  assert.match(markup, /aria-label="Get started"/);
});

test('SSR create form renders a labelled question, two initial options, and an add control', async () => {
  const markup = await renderComponent('CreatePollPage', { onCreated() {} });
  assert.match(markup, /<form\b/);
  assert.match(markup, /<label\b[^>]*for="question"[^>]*>Your question<\/label>/);
  const question = markup.match(/<textarea\b[^>]*id="question"[^>]*>/)?.[0];
  assert.ok(question);
  assert.match(question, /maxlength="500"/i);
  assert.match(question, /\brequired(?:="")?/);
  const options = [...markup.matchAll(/<input\b[^>]*id="option-\d+"[^>]*>/g)].map((match) => match[0]);
  assert.equal(options.length, 2);
  for (const [index, option] of options.entries()) {
    assert.match(option, /maxlength="200"/i);
    assert.match(option, /\brequired(?:="")?/);
    assert.ok(markup.includes(`for="option-${index}"`));
  }
  const addButton = markup.match(/<button\b[^>]*>[^<]*Add option<\/button>/)?.[0];
  assert.ok(addButton);
  assert.doesNotMatch(addButton, /\bdisabled/);
});

test('SSR join form renders an accessible six-digit numeric input and an initially disabled submit button', async () => {
  const markup = await renderComponent('JoinPollPage', { onJoined() {} });
  assert.match(markup, /<label\b[^>]*for="room-code"[^>]*>Room code<\/label>/);
  const input = markup.match(/<input\b[^>]*id="room-code"[^>]*>/)?.[0];
  assert.ok(input);
  assert.match(input, /inputmode="numeric"/i);
  assert.match(input, /maxlength="6"/i);
  assert.match(input, /aria-describedby="join-hint"/);
  assert.match(markup, /id="join-hint"/);
  assert.match(markup, /<button\b[^>]*\bdisabled(?:="")?[^>]*>Join poll/);
});

test('SSR results retain full option text, counts, and percentages in an accessible ordered list', async () => {
  const results = [
    { optionId: 11, text: 'A full answer option that remains readable alongside the chart', count: 1, percentage: 33.33 },
    { optionId: 12, text: 'Another complete option with two votes', count: 2, percentage: 66.67 },
    { optionId: 13, text: 'An option with no votes yet', count: 0, percentage: 0 },
  ];
  const markup = await renderComponent('ResultsChart', { results });
  assert.match(markup, /<ol\b[^>]*aria-label="Results by answer"/);
  const rows = [...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => plainText(match[1]));
  assert.equal(rows.length, results.length);
  for (const [index, result] of results.entries()) {
    assert.ok(rows[index].includes(result.text));
    assert.ok(rows[index].includes(`${result.count} ${result.count === 1 ? 'vote' : 'votes'}`));
    assert.ok(rows[index].includes(`${result.percentage.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`));
  }
});
