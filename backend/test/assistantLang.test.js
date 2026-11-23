import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitReplyLang, resolveReplyLang, languageDirective } from '../../shared/assistantLang.js';

test('Auto and missing lang default to English, even when the question or data would be Chinese', () => {
  const history = [{ role: 'user', content: 'let me know about cosco' }];
  assert.equal(resolveReplyLang(undefined, history), 'en');
  assert.equal(resolveReplyLang('auto', history), 'en');
  assert.equal(resolveReplyLang('en', history), 'en');
  const chineseQuestion = [{ role: 'user', content: 'COSCO 最近的拜访情况如何？' }];
  assert.equal(resolveReplyLang(undefined, chineseQuestion), 'en');
  assert.equal(resolveReplyLang('auto', chineseQuestion), 'en');
  assert.equal(explicitReplyLang('let me know about cosco'), null);
  assert.equal(explicitReplyLang('COSCO 最近的拜访情况如何？'), null);
  assert.match(languageDirective('en'), /Reply in English/);
  assert.match(languageDirective('en'), /do not auto-detect the reply language/i);
});

test('the 中文 toggle is Chinese, and an explicit Chinese request overrides Auto or EN', () => {
  assert.equal(resolveReplyLang('zh', [{ role: 'user', content: 'let me know about cosco' }]), 'zh');
  assert.equal(resolveReplyLang('auto', [{ role: 'user', content: 'Please answer in Chinese about this customer' }]), 'zh');
  assert.equal(resolveReplyLang(undefined, [{ role: 'user', content: '用中文回答，介绍一下这家客户' }]), 'zh');
  assert.equal(resolveReplyLang('en', [{ role: 'user', content: '请用中文回复' }]), 'zh');
  assert.equal(explicitReplyLang('answer in Chinese'), 'zh');
  assert.match(languageDirective('zh'), /用中文回答/);
  assert.match(languageDirective('zh'), /报告链接/);
});

test('an explicit English request overrides the 中文 toggle', () => {
  assert.equal(resolveReplyLang('zh', [{ role: 'user', content: 'in english' }]), 'en');
  assert.equal(resolveReplyLang('zh', [{ role: 'user', content: '请用英文回答' }]), 'en');
  assert.equal(explicitReplyLang('in english please'), 'en');
});
