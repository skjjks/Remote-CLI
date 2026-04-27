import { describe, test, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';

const smart = new SmartCardBuilder();

describe('buildEditFormCard', () => {
  test('produces schema 2.0 card with form container + multiline input + save/cancel buttons', () => {
    const card = smart.buildEditFormCard({
      path: '/tmp/config.json',
      content: '{\n  "port": 8080\n}',
      requesterOpenId: 'ou_1',
    });
    const body = card as any;
    expect(body.schema).toBe('2.0');
    expect(body.header.template).toBe('blue');
    expect(body.header.title.content).toContain('/tmp/config.json');
    expect(body.header.title.content).toMatch(/\d+\s*B/);

    const form = body.body.elements[0];
    expect(form.tag).toBe('form');
    expect(form.name).toBe('edit_form');

    const input = form.elements[0];
    expect(input.tag).toBe('input');
    expect(input.input_type).toBe('multiline_text');
    expect(input.name).toBe('content');
    expect(input.default_value).toBe('{\n  "port": 8080\n}');
    expect(input.max_length).toBe(1000);
  });

  test('save button value has kind=editSave and the path', () => {
    const card = smart.buildEditFormCard({
      path: '/tmp/foo.yaml',
      content: 'a: 1',
      requesterOpenId: 'ou_abc',
    });
    const form = (card as any).body.elements[0];
    const columnSet = form.elements[1];
    const saveBtn = columnSet.columns[0].elements[0];
    expect(saveBtn.action_type).toBe('form_submit');
    expect(saveBtn.text.content).toContain('Save');
    expect(saveBtn.value).toEqual({
      kind: 'editSave',
      path: '/tmp/foo.yaml',
      requesterOpenId: 'ou_abc',
    });
  });

  test('cancel button value has kind=editCancel and the path', () => {
    const card = smart.buildEditFormCard({
      path: '/tmp/foo.yaml',
      content: 'a: 1',
      requesterOpenId: 'ou_abc',
    });
    const form = (card as any).body.elements[0];
    const columnSet = form.elements[1];
    const cancelBtn = columnSet.columns[1].elements[0];
    expect(cancelBtn.action_type).toBe('form_submit');
    expect(cancelBtn.text.content).toContain('Cancel');
    expect(cancelBtn.value).toEqual({
      kind: 'editCancel',
      path: '/tmp/foo.yaml',
      requesterOpenId: 'ou_abc',
    });
  });

  test('buildEditSavedCard shows green header + saved note', () => {
    const card = smart.buildEditSavedCard({
      path: '/tmp/foo.yaml',
      byteSize: 42,
    });
    const body = card as any;
    expect(body.header.template).toBe('green');
    expect(body.header.title.content).toContain('✅');
    expect(body.header.title.content).toContain('/tmp/foo.yaml');
    expect(body.body.elements[0].content).toContain('42');
  });

  test('buildEditCancelledCard shows grey header + cancelled note', () => {
    const card = smart.buildEditCancelledCard({ path: '/tmp/foo.yaml' });
    const body = card as any;
    expect(body.header.template).toBe('grey');
    expect(body.header.title.content).toContain('✗');
    expect(body.body.elements[0].content).toContain('cancelled');
  });
});
