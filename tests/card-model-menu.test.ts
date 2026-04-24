import { describe, test, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';

describe('buildModelMenuCardV2', () => {
  const smart = new SmartCardBuilder();

  test('renders one callback button per model plus reset, with current model in header', () => {
    const card = smart.buildModelMenuCardV2({
      currentModel: 'ppio/pa/claude-opus-4-7',
      backend: 'claude',
      models: [
        { shortcut: 'opus', model: 'ppio/pa/claude-opus-4-7', desc: 'Most capable' },
        { shortcut: 'sonnet', model: 'ppio/pa/claude-sonnet-4-5', desc: 'Balanced' },
      ],
      requesterOpenId: 'ou_1',
    });

    expect(card).toMatchObject({
      schema: '2.0',
      config: { update_multi: true },
    });
    const body = card as any;
    expect(body.body.elements[0].tag).toBe('markdown');
    expect(body.body.elements[0].content).toContain('ppio/pa/claude-opus-4-7');

    const columnSet = body.body.elements[1];
    expect(columnSet.tag).toBe('column_set');
    expect(columnSet.columns).toHaveLength(2);

    const btnOpus = columnSet.columns[0].elements[0];
    expect(btnOpus).toMatchObject({
      tag: 'button',
      text: { tag: 'plain_text', content: 'opus' },
      behaviors: [{
        type: 'callback',
        value: {
          kind: 'modelSwitch',
          choice: 'opus',
          backend: 'claude',
          requesterOpenId: 'ou_1',
        },
      }],
    });

    const resetColumnSet = body.body.elements[2];
    expect(resetColumnSet.tag).toBe('column_set');
    const btnReset = resetColumnSet.columns[0].elements[0];
    expect(btnReset.text.content).toContain('Reset');
    expect(btnReset.behaviors[0].value.choice).toBe('reset');
  });

  test('renders "default (no override)" when currentModel is undefined', () => {
    const card = smart.buildModelMenuCardV2({
      currentModel: undefined,
      backend: 'claude',
      models: [{ shortcut: 'opus', model: 'X', desc: undefined }],
      requesterOpenId: 'ou_1',
    });
    const body = card as any;
    expect(body.body.elements[0].content).toContain('default');
  });
  test('renders grouped column_sets when models carry group field', () => {
    const card = smart.buildModelMenuCardV2({
      currentModel: undefined,
      backend: 'opencode',
      models: [
        { shortcut: 'gpt-5.4', model: 'Mify-OpenAI/azure_openai/gpt-5.4', group: 'Mify-OpenAI' },
        { shortcut: 'gpt-5.4-pro', model: 'Mify-OpenAI/azure_openai/gpt-5.4-pro', group: 'Mify-OpenAI' },
        { shortcut: 'claude-opus-4-7', model: 'Mify-Anthropic/ppio/pa/claude-opus-4-7', group: 'Mify-Anthropic' },
      ],
      requesterOpenId: 'ou_1',
    });

    const body = (card as any).body.elements;

    const separatorTexts = body
      .filter((e: any) => e.tag === 'markdown' && typeof e.content === 'string' && e.content.includes('──'))
      .map((e: any) => e.content);
    expect(separatorTexts.some((s: string) => s.includes('Mify-OpenAI'))).toBe(true);
    expect(separatorTexts.some((s: string) => s.includes('Mify-Anthropic'))).toBe(true);

    const columnSets = body.filter((e: any) => e.tag === 'column_set');
    expect(columnSets.length).toBeGreaterThanOrEqual(3);

    const openAIset = columnSets.find((cs: any) =>
      cs.columns[0]?.elements[0]?.behaviors?.[0]?.value?.choice === 'gpt-5.4'
    );
    expect(openAIset).toBeDefined();
    expect(openAIset.columns).toHaveLength(2);
  });
});

// ── Handler integration tests (Task 7) ──

import { vi, beforeEach, afterEach } from 'vitest';
import { modelOverrides } from '../src/state';
import { handleCardAction } from '../src/handlers/card-action';

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({ updateCard: vi.fn(async () => {}) }),
}));

import '../src/handlers/card-action';

describe('modelSwitch card action', () => {
  beforeEach(() => modelOverrides.clear());
  afterEach(() => modelOverrides.clear());

  test('opus click sets modelOverrides and returns success toast', async () => {
    const result = await handleCardAction({
      action: {
        value: {
          kind: 'modelSwitch',
          choice: 'opus',
          backend: 'claude',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });
    expect(result.toast?.type).toBe('success');
    expect(modelOverrides.has('oc_1')).toBe(true);
  });

  test('reset click clears modelOverrides', async () => {
    modelOverrides.set('oc_1', 'some/model');
    const result = await handleCardAction({
      action: {
        value: {
          kind: 'modelSwitch',
          choice: 'reset',
          backend: 'claude',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_1' },
    });
    expect(result.toast?.type).toBe('success');
    expect(modelOverrides.has('oc_1')).toBe(false);
  });

  test('non-requester click is rejected', async () => {
    const result = await handleCardAction({
      action: {
        value: {
          kind: 'modelSwitch',
          choice: 'opus',
          backend: 'claude',
          requesterOpenId: 'ou_1',
        },
      },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      operator: { open_id: 'ou_STRANGER' },
    });
    expect(result.toast?.type).toBe('warning');
    expect(modelOverrides.has('oc_1')).toBe(false);
  });
});
