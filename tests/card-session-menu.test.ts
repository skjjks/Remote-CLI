import { describe, test, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';

describe('buildSessionMenuCardV2', () => {
  const smart = new SmartCardBuilder();

  test('renders disabled button for active session, clickable for others, plus 3 new buttons', () => {
    const card = smart.buildSessionMenuCardV2({
      activeSessionId: 0,
      sessions: [
        { id: 0, type: 'terminal', createdDisplay: '5m ago' },
        { id: 1, type: 'claude', createdDisplay: '45m ago' },
      ],
      requesterOpenId: 'ou_1',
    });

    const body = card as any;
    expect(body.body.elements[0].tag).toBe('markdown');

    const existing = body.body.elements[1];
    expect(existing.tag).toBe('column_set');
    expect(existing.columns).toHaveLength(2);

    const activeBtn = existing.columns[0].elements[0];
    expect(activeBtn.disabled).toBe(true);
    expect(activeBtn.text.content).toMatch(/^✓.*#0.*terminal/);

    const clickableBtn = existing.columns[1].elements[0];
    expect(clickableBtn.disabled).toBeFalsy();
    expect(clickableBtn.behaviors[0].value).toMatchObject({
      kind: 'sessionSwitch',
      choice: { type: 'existing', sessionId: 1 },
      requesterOpenId: 'ou_1',
    });

    expect(body.body.elements[2].tag).toBe('markdown');

    const newRow = body.body.elements[3];
    expect(newRow.tag).toBe('column_set');
    expect(newRow.columns).toHaveLength(3);
    expect(newRow.columns[0].elements[0].behaviors[0].value).toMatchObject({
      kind: 'sessionSwitch',
      choice: { type: 'new', backend: 'claude' },
    });
    expect(newRow.columns[1].elements[0].behaviors[0].value.choice.backend).toBe('opencode');
    expect(newRow.columns[2].elements[0].behaviors[0].value.choice.backend).toBe('terminal');
  });

  test('empty session list renders only the new-session row with a "No sessions yet" note', () => {
    const card = smart.buildSessionMenuCardV2({
      activeSessionId: undefined,
      sessions: [],
      requesterOpenId: 'ou_1',
    });
    const body = card as any;

    const existingColumnSet = body.body.elements.find(
      (e: any, i: number) => i < body.body.elements.length - 1 && e.tag === 'column_set'
    );
    expect(existingColumnSet).toBeUndefined();

    const lastEl = body.body.elements.at(-1);
    expect(lastEl.tag).toBe('column_set');
    expect(lastEl.columns).toHaveLength(3);
  });
});
