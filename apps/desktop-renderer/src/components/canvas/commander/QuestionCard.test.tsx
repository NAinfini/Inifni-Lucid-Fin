// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard } from './QuestionCard.js';

const t = (key: string): string =>
  (
    ({
      'commander.question.title': 'Question Tool:',
      'commander.question.otherAnswer': 'Other answer...',
      'commander.question.submit': 'Submit',
      'commander.question.confirmChoice': 'Confirm choice and continue',
      'commander.question.selectOption': 'Select an option',
    }) as Record<string, string>
  )[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('QuestionCard', () => {
  it('shows toggle link for custom input initially', () => {
    render(<QuestionCard question="Pick one" options={[]} onAnswer={() => {}} t={t} />);

    expect(screen.getByText('Other answer...')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Other answer...')).toBeNull();
  });

  it('reveals custom input after clicking toggle', () => {
    render(<QuestionCard question="Pick one" options={[]} onAnswer={() => {}} t={t} />);

    fireEvent.click(screen.getByText('Other answer...'));
    expect(screen.getByPlaceholderText('Other answer...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });

  it('only exposes a custom answer control when free text is allowed', () => {
    render(
      <QuestionCard
        question="Pick one"
        options={[{ label: 'Yes' }]}
        allowFreeText={false}
        onAnswer={() => {}}
        t={t}
      />,
    );

    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy();
    expect(screen.queryByText('Other answer...')).toBeNull();
  });

  it('renders option buttons and filters blank labels', () => {
    render(
      <QuestionCard
        question="Long question"
        options={[{ label: '   ' }, { label: 'Yes' }, { label: '' }]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText('Long question')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy();
  });

  it('renders options as full-width rows and separates primary and alternate actions', () => {
    render(
      <QuestionCard
        question="Choose"
        options={[
          { label: 'First', description: 'First direction' },
          { label: 'Second', description: 'Second direction' },
          { label: 'Third' },
          { label: 'Fourth' },
        ]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    const optionGroup = screen.getByRole('group', { name: 'Select an option' });
    expect(optionGroup.className).toContain('flex-col');
    for (const label of ['First', 'Second', 'Third', 'Fourth']) {
      expect(screen.getByRole('button', { name: label }).className).toContain('w-full');
    }

    const confirm = screen.getByRole('button', { name: 'Confirm choice and continue' });
    const other = screen.getByRole('button', { name: 'Other answer...' });
    expect(confirm.parentElement).toBe(other.parentElement);
    expect(confirm.parentElement?.className).toContain('gap-x-4');
  });

  it('renders an optional generated-image preview without changing selection behavior', () => {
    const previewAssetHash = 'b'.repeat(64);
    render(
      <QuestionCard
        question="Pick a visual direction"
        options={[{ label: 'Dreamlike', previewAssetHash }, { label: 'Natural' }]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    const preview = screen.getByRole('img', { name: 'Dreamlike' });
    expect(preview.getAttribute('src')).toBe(`lucid-asset://${previewAssetHash}/image/png`);
    expect(screen.getByRole('button', { name: 'Dreamlike' })).toBeTruthy();
  });

  it('uses stable list keys so duplicate labels do not trigger React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <QuestionCard
        question="Choose"
        options={[{ label: 'Yes' }, { label: 'Yes' }]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    const duplicateKeyWarning = consoleError.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('Encountered two children with the same key'),
      ),
    );
    expect(duplicateKeyWarning).toBe(false);

    consoleError.mockRestore();
  });

  it('stages an option selection before sending it through the existing answer callback', () => {
    const onAnswer = vi.fn();

    render(
      <QuestionCard
        question="Choose"
        options={[{ label: 'Yes' }, { label: 'No' }]}
        onAnswer={onAnswer}
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice and continue' }));
    expect(onAnswer).toHaveBeenCalledWith('Yes');
  });

  it('starts with a clean selection when the host mounts a new question', () => {
    const onAnswer = vi.fn();
    const { rerender } = render(
      <QuestionCard
        key="question-1"
        question="First question"
        options={[{ label: 'Yes' }, { label: 'No' }]}
        onAnswer={onAnswer}
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm choice and continue',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    rerender(
      <QuestionCard
        key="question-2"
        question="Second question"
        options={[{ label: 'Keep' }, { label: 'Change' }]}
        onAnswer={onAnswer}
        t={t}
      />,
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm choice and continue',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText('Second question')).toBeTruthy();
  });

  it('submits trimmed custom answer on Enter and click', () => {
    const onAnswer = vi.fn();

    render(<QuestionCard question="Q" options={[]} onAnswer={onAnswer} t={t} />);

    fireEvent.click(screen.getByText('Other answer...'));

    const input = screen.getByPlaceholderText('Other answer...');
    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('hello');

    fireEvent.change(input, { target: { value: '  world  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenCalledWith('world');
  });
});
