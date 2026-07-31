import React, { useEffect, useRef, useState } from 'react';
import { TALLY_FONT } from './TallyChrome';
import { useShortcuts } from './keyboard';

/**
 * Tally's calculator — the strip that drops into the bottom-right corner on
 * Ctrl+N, takes an expression, and keeps the answers above it. The status line
 * has advertised "Ctrl+N: Calculator" since the chrome was written; this is the
 * thing it was advertising.
 *
 * The screen behind stays live: the calculator is not a modal pop-up in Tally
 * either, you type into it and carry on.
 */

type Token = number | string;

/** Split "1,200 * 5%" into numbers and operators. Commas are noise in Tally. */
const tokenize = (input: string): Token[] | null => {
  const tokens: Token[] = [];
  const source = input.replace(/,/g, '');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ') {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      const value = Number(source.slice(i, j));
      if (!Number.isFinite(value)) return null;
      tokens.push(value);
      i = j;
      continue;
    }
    if ('+-*/%()'.includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
};

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };

const apply = (op: string, a: number, b: number): number =>
  op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : (a * b) / 100;

/**
 * Shunting-yard, evaluated as it goes. Hand-rolled rather than `eval` or `new
 * Function` — an expression box that runs arbitrary JavaScript is not something
 * to put in an accounting screen.
 */
const evaluate = (input: string): number | null => {
  const tokens = tokenize(input);
  if (!tokens || tokens.length === 0) return null;
  const values: number[] = [];
  const ops: string[] = [];

  const reduce = (): boolean => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op === undefined || a === undefined || b === undefined) return false;
    values.push(apply(op, a, b));
    return true;
  };

  for (const token of tokens) {
    if (typeof token === 'number') {
      values.push(token);
    } else if (token === '(') {
      ops.push(token);
    } else if (token === ')') {
      while (ops.length > 0 && ops[ops.length - 1] !== '(') if (!reduce()) return null;
      if (ops.pop() !== '(') return null;
    } else {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== '(' &&
        PRECEDENCE[ops[ops.length - 1]] >= PRECEDENCE[token]
      ) {
        if (!reduce()) return null;
      }
      ops.push(token);
    }
  }
  while (ops.length > 0) {
    if (ops[ops.length - 1] === '(') return null;
    if (!reduce()) return null;
  }
  if (values.length !== 1 || !Number.isFinite(values[0])) return null;
  return values[0];
};

const TallyCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [entry, setEntry] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasFocus = () => document.activeElement === inputRef.current;

  const compute = (): void => {
    const answer = evaluate(entry);
    setLines((prev) => [...prev, answer === null ? `${entry} = ?` : `${entry} = ${answer.toLocaleString('en-IN')}`].slice(-8));
    setEntry('');
  };

  // The `field` layer sits above the screen's own keys but blocks nothing else,
  // so Esc closes the calculator instead of unwinding the screen behind it.
  useShortcuts([
    { combo: 'Esc', layer: 'field', allowInInput: true, when: hasFocus, run: onClose },
    { combo: 'Enter', layer: 'field', allowInInput: true, when: hasFocus, run: compute },
  ]);

  return (
    <div
      style={TALLY_FONT}
      className="fixed bottom-6 right-4 z-[90] w-64 border border-[#7f7f7f] bg-[#eef2f7] text-[13px] shadow-[2px_2px_6px_rgba(0,0,0,0.35)] print:hidden"
    >
      <div className="flex items-center bg-[#16437e] px-2 py-0.5 font-semibold text-white">
        Calculator
        <button type="button" onClick={onClose} className="ml-auto px-1 font-bold hover:text-red-300" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-[72px] px-2 py-1 text-right font-mono">
        {lines.length === 0 ? (
          <div className="text-left text-[11px] italic text-gray-500">
            Type an expression and press Enter. + − × ÷ % and brackets.
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={`${line}-${i}`} className="truncate" title={line}>
              {line}
            </div>
          ))
        )}
      </div>
      <input
        ref={inputRef}
        value={entry}
        onChange={(e) => setEntry(e.target.value)}
        placeholder="="
        className="w-full border-t border-[#c8a020] bg-[#ffe9a8] px-2 py-1 text-right font-mono font-semibold text-black focus:outline-none"
      />
    </div>
  );
};

export default TallyCalculator;
