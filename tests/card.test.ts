/**
 * Unit tests for the CardBuilder module.
 */

import { describe, it, expect } from 'vitest';
import {
  CardBuilder,
  FeishuCard,
  isMoreOptionsValue,
  getMaxVisibleButtons,
} from '../src/bot/card';
import type { PromptDetectionResult } from '../src/terminal/prompt';

describe('CardBuilder', () => {
  const builder = new CardBuilder();

  describe('buildYesNoCard', () => {
    it('should build a valid yes/no card', () => {
      const result: PromptDetectionResult = {
        type: 'yesno',
        message: 'Do you want to continue?',
        options: [
          { label: 'Yes', value: 'y' },
          { label: 'No', value: 'n' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildYesNoCard(result);

      expect(card).toBeDefined();
      expect(card?.config.wide_screen_mode).toBe(true);
      expect(card?.elements).toHaveLength(2);

      // Check message element
      const messageElement = card?.elements[0];
      expect(messageElement?.tag).toBe('div');
      if (messageElement?.tag === 'div') {
        expect(messageElement.text.tag).toBe('plain_text');
        expect(messageElement.text.content).toBe('Do you want to continue?');
      }

      // Check action element
      const actionElement = card?.elements[1];
      expect(actionElement?.tag).toBe('action');
      if (actionElement?.tag === 'action') {
        expect(actionElement.actions).toHaveLength(2);
        expect(actionElement.actions[0].value).toBe('yes');
        expect(actionElement.actions[0].text.content).toBe('Yes');
        expect(actionElement.actions[1].value).toBe('no');
        expect(actionElement.actions[1].text.content).toBe('No');
      }
    });

    it('should use "yes" and "no" as button values', () => {
      const result: PromptDetectionResult = {
        type: 'yesno',
        message: 'Confirm?',
        options: [],
        isMultiSelect: false,
      };

      const card = builder.buildYesNoCard(result);

      if (card?.elements[1]?.tag === 'action') {
        const values = card.elements[1].actions.map((a) => a.value);
        expect(values).toEqual(['yes', 'no']);
      }
    });
  });

  describe('buildNumberedCard', () => {
    it('should build a valid numbered options card', () => {
      const result: PromptDetectionResult = {
        type: 'numbered',
        message: 'Select an option:',
        options: [
          { label: 'Option A', value: '1' },
          { label: 'Option B', value: '2' },
          { label: 'Option C', value: '3' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildNumberedCard(result);

      expect(card).toBeDefined();
      expect(card?.config.wide_screen_mode).toBe(true);
      expect(card?.elements).toHaveLength(2);

      // Check action buttons
      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions).toHaveLength(3);
        expect(card.elements[1].actions[0].value).toBe('1');
        expect(card.elements[1].actions[1].value).toBe('2');
        expect(card.elements[1].actions[2].value).toBe('3');
      }
    });

    it('should show first 4 options with "More options..." button for >4 options', () => {
      const result: PromptDetectionResult = {
        type: 'numbered',
        message: 'Choose:',
        options: [
          { label: 'Option 1', value: '1' },
          { label: 'Option 2', value: '2' },
          { label: 'Option 3', value: '3' },
          { label: 'Option 4', value: '4' },
          { label: 'Option 5', value: '5' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildNumberedCard(result);

      if (card?.elements[1]?.tag === 'action') {
        const actions = card.elements[1].actions;
        expect(actions).toHaveLength(5); // 4 options + "More options..."

        // First 4 buttons should be the options
        expect(actions[0].value).toBe('1');
        expect(actions[1].value).toBe('2');
        expect(actions[2].value).toBe('3');
        expect(actions[3].value).toBe('4');

        // Last button should be "More options..."
        expect(actions[4].value).toBe('__more__');
        expect(actions[4].text.content).toBe('More options...');
      }
    });

    it('should use option values as button values', () => {
      const result: PromptDetectionResult = {
        type: 'numbered',
        message: 'Select:',
        options: [
          { label: 'First', value: '0' },
          { label: 'Second', value: '1' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildNumberedCard(result);

      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions[0].value).toBe('0');
        expect(card.elements[1].actions[1].value).toBe('1');
      }
    });
  });

  describe('buildAskUserCard', () => {
    it('should build a valid AskUserQuestion card', () => {
      const result: PromptDetectionResult = {
        type: 'askuser',
        message: 'What is your preference?',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildAskUserCard(result);

      expect(card).toBeDefined();
      expect(card?.config.wide_screen_mode).toBe(true);
      expect(card?.elements).toHaveLength(2);

      // Check message
      if (card?.elements[0]?.tag === 'div') {
        expect(card.elements[0].text.content).toBe('What is your preference?');
      }

      // Check buttons
      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions).toHaveLength(2);
        expect(card.elements[1].actions[0].value).toBe('a');
        expect(card.elements[1].actions[1].value).toBe('b');
      }
    });

    it('should add multi-select hint for multi-select questions', () => {
      const result: PromptDetectionResult = {
        type: 'askuser',
        message: 'Select multiple options:',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
        isMultiSelect: true,
      };

      const card = builder.buildAskUserCard(result);

      if (card?.elements[0]?.tag === 'div') {
        expect(card.elements[0].text.content).toContain('Multi-select');
      }
    });

    it('should use option index as button value', () => {
      const result: PromptDetectionResult = {
        type: 'askuser',
        message: 'Choose:',
        options: [
          { label: 'First', value: '0' },
          { label: 'Second', value: '1' },
          { label: 'Third', value: '2' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildAskUserCard(result);

      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions[0].value).toBe('0');
        expect(card.elements[1].actions[1].value).toBe('1');
        expect(card.elements[1].actions[2].value).toBe('2');
      }
    });

    it('should handle >4 options with "More options..." button', () => {
      const result: PromptDetectionResult = {
        type: 'askuser',
        message: 'Select:',
        options: [
          { label: 'Opt 1', value: '0' },
          { label: 'Opt 2', value: '1' },
          { label: 'Opt 3', value: '2' },
          { label: 'Opt 4', value: '3' },
          { label: 'Opt 5', value: '4' },
          { label: 'Opt 6', value: '5' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildAskUserCard(result);

      if (card?.elements[1]?.tag === 'action') {
        const actions = card.elements[1].actions;
        expect(actions).toHaveLength(5); // 4 options + "More options..."
        expect(actions[4].value).toBe('__more__');
      }
    });
  });

  describe('buildCard', () => {
    it('should route to yes/no builder for yesno type', () => {
      const result: PromptDetectionResult = {
        type: 'yesno',
        message: 'Continue?',
        options: [],
        isMultiSelect: false,
      };

      const card = builder.buildCard(result);

      expect(card).toBeDefined();
      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions[0].value).toBe('yes');
        expect(card.elements[1].actions[1].value).toBe('no');
      }
    });

    it('should route to numbered builder for numbered type', () => {
      const result: PromptDetectionResult = {
        type: 'numbered',
        message: 'Select:',
        options: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildCard(result);

      expect(card).toBeDefined();
      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions[0].value).toBe('1');
        expect(card.elements[1].actions[1].value).toBe('2');
      }
    });

    it('should route to askuser builder for askuser type', () => {
      const result: PromptDetectionResult = {
        type: 'askuser',
        message: 'Pick:',
        options: [
          { label: 'X', value: 'x' },
          { label: 'Y', value: 'y' },
        ],
        isMultiSelect: false,
      };

      const card = builder.buildCard(result);

      expect(card).toBeDefined();
      if (card?.elements[1]?.tag === 'action') {
        expect(card.elements[1].actions[0].value).toBe('x');
        expect(card.elements[1].actions[1].value).toBe('y');
      }
    });

    it('should return null for null type', () => {
      const result: PromptDetectionResult = {
        type: null,
        message: '',
        options: [],
        isMultiSelect: false,
      };

      const card = builder.buildCard(result);

      expect(card).toBeNull();
    });
  });
});

describe('Card JSON structure validity', () => {
  const builder = new CardBuilder();

  it('should produce valid JSON-serializable yes/no card', () => {
    const result: PromptDetectionResult = {
      type: 'yesno',
      message: 'Test message',
      options: [],
      isMultiSelect: false,
    };

    const card = builder.buildYesNoCard(result);

    // Should be JSON serializable without errors
    const json = JSON.stringify(card);
    const parsed = JSON.parse(json);

    expect(parsed.config.wide_screen_mode).toBe(true);
    expect(parsed.elements).toBeInstanceOf(Array);
    expect(parsed.elements[0].tag).toBe('div');
    expect(parsed.elements[1].tag).toBe('action');
  });

  it('should produce valid JSON-serializable numbered card', () => {
    const result: PromptDetectionResult = {
      type: 'numbered',
      message: 'Choose:',
      options: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
      ],
      isMultiSelect: false,
    };

    const card = builder.buildNumberedCard(result);

    const json = JSON.stringify(card);
    const parsed = JSON.parse(json);

    expect(parsed.config.wide_screen_mode).toBe(true);
    expect(parsed.elements[0].text.content).toBe('Choose:');
    expect(parsed.elements[1].actions[0].text.content).toBe('A');
  });

  it('should produce valid JSON-serializable askuser card', () => {
    const result: PromptDetectionResult = {
      type: 'askuser',
      message: 'Question?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
      isMultiSelect: false,
    };

    const card = builder.buildAskUserCard(result);

    const json = JSON.stringify(card);
    const parsed = JSON.parse(json);

    expect(parsed.config.wide_screen_mode).toBe(true);
    expect(parsed.elements).toBeInstanceOf(Array);
  });

  it('should match expected Feishu card schema', () => {
    const result: PromptDetectionResult = {
      type: 'yesno',
      message: 'Test',
      options: [],
      isMultiSelect: false,
    };

    const card = builder.buildYesNoCard(result);

    // Verify schema structure
    expect(card).toHaveProperty('config');
    expect(card).toHaveProperty('elements');
    expect(card?.config).toHaveProperty('wide_screen_mode');

    const element = card?.elements[0];
    expect(element).toHaveProperty('tag');
    expect(element).toHaveProperty('text');

    if (element?.tag === 'div') {
      expect(element.text).toHaveProperty('tag');
      expect(element.text).toHaveProperty('content');
    }
  });
});

describe('Helper functions', () => {
  describe('isMoreOptionsValue', () => {
    it('should return true for "__more__" value', () => {
      expect(isMoreOptionsValue('__more__')).toBe(true);
    });

    it('should return false for other values', () => {
      expect(isMoreOptionsValue('yes')).toBe(false);
      expect(isMoreOptionsValue('no')).toBe(false);
      expect(isMoreOptionsValue('1')).toBe(false);
      expect(isMoreOptionsValue('')).toBe(false);
    });
  });

  describe('getMaxVisibleButtons', () => {
    it('should return 4', () => {
      expect(getMaxVisibleButtons()).toBe(4);
    });
  });
});

describe('>4 options handling', () => {
  const builder = new CardBuilder();

  it('should show exactly 4 options plus "More options..." for 5 options', () => {
    const result: PromptDetectionResult = {
      type: 'numbered',
      message: 'Select:',
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' },
        { label: '5', value: '5' },
      ],
      isMultiSelect: false,
    };

    const card = builder.buildNumberedCard(result);

    if (card?.elements[1]?.tag === 'action') {
      expect(card.elements[1].actions).toHaveLength(5);
      expect(card.elements[1].actions[4].value).toBe('__more__');
    }
  });

  it('should show exactly 4 options plus "More options..." for 10 options', () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      label: `Option ${i + 1}`,
      value: String(i + 1),
    }));

    const result: PromptDetectionResult = {
      type: 'numbered',
      message: 'Select:',
      options,
      isMultiSelect: false,
    };

    const card = builder.buildNumberedCard(result);

    if (card?.elements[1]?.tag === 'action') {
      expect(card.elements[1].actions).toHaveLength(5); // 4 + more
      expect(card.elements[1].actions[4].text.content).toBe('More options...');
    }
  });

  it('should not show "More options..." for exactly 4 options', () => {
    const result: PromptDetectionResult = {
      type: 'numbered',
      message: 'Select:',
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' },
      ],
      isMultiSelect: false,
    };

    const card = builder.buildNumberedCard(result);

    if (card?.elements[1]?.tag === 'action') {
      expect(card.elements[1].actions).toHaveLength(4);
      const values = card.elements[1].actions.map((a) => a.value);
      expect(values).not.toContain('__more__');
    }
  });

  it('should not show "More options..." for fewer than 4 options', () => {
    const result: PromptDetectionResult = {
      type: 'numbered',
      message: 'Select:',
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
      ],
      isMultiSelect: false,
    };

    const card = builder.buildNumberedCard(result);

    if (card?.elements[1]?.tag === 'action') {
      expect(card.elements[1].actions).toHaveLength(2);
      const values = card.elements[1].actions.map((a) => a.value);
      expect(values).not.toContain('__more__');
    }
  });
});
