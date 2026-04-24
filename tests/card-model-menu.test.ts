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
    expect(columnSet.columns).toHaveLength(3);

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

    const btnReset = columnSet.columns[2].elements[0];
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
});
