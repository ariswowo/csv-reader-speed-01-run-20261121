// Fast drop-in for make.fun's csv-reader 1.0.0 (csv-reader-speed-01-run-20261121).
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the same
// {text, header}: {columns, rows, errors}. Pure, deterministic, no state kept
// between calls, no I/O, no randomness, no clock.
//
// Why it is faster than the reference: the reference reads one character at a
// time and builds every field one character at a time (string += per char).
// This parser instead jumps with String#indexOf (native, memchr-like) and
// String#slice, so a field is usually one slice and a clean record is one
// split(','):
//   - Record fast path: if the next line holds no '"' and no stray CR, the
//     whole record is text.slice(...).split(',').
//   - Unquoted fields: the next ',' is found with indexOf and the field is
//     one slice; a slice holding no CR or LF is done. Only a field holding
//     a CR or a line break takes the careful path (stray CRs dropped, CRLF
//     ends the record).
//   - Quoted fields: the closing quote is found with indexOf, skipping
//     doubled quotes; when the quoted content holds no '""' and no CR/LF the
//     value is a slice, otherwise one replaceAll pass normalises it.
//   - No closures or helper calls in the hot path beyond one small scanner;
//     no per-character work, no regex, no quadratic behaviour anywhere.
//
// The semantics mirror vendor/csv-reader/index.js exactly, including the
// error order and the {code, line, row} of every error:
//   - U+FEFF at the very start is dropped; a record ends at LF or CRLF and
//     an empty line is no record; a CR outside quotes not followed by LF is
//     dropped (stray_cr); a field opening with a quote runs to the next
//     non-doubled quote, '""' inside is one quote, CRLF / lone CR inside
//     read as LF; what follows the closing quote up to the next comma or
//     line break is appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character and the text after
//     it is read again as unquoted (unterminated_quote); a quote inside an
//     unquoted field is literal; fields stay strings, never trimmed.
//   - columns is the first record when header is true, else null; rows are
//     the records after it, each padded (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's
//     width; errors are in the order met, a record's short_row/long_row when
//     it ends; line is the 1-based line its record starts on, counting every
//     LF, CRLF and lone CR inside quotes.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  let fieldEnded = END;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at `p`, with `acc` (a string, or null)
  // already kept before it. The common case is one indexOf(',') and one
  // slice: a field that holds no CR or LF is done. Anything else (a line
  // break before the next comma, a CR) goes to scanUnquotedSlow, which
  // handles stray CRs, CRLF and the end of the text exactly. Updates pos
  // and line, sets fieldEnded, returns the field value.
  function scanUnquoted(p, acc) {
    const ci = text.indexOf(',', p);
    if (ci !== -1) {
      const piece = text.slice(p, ci);
      if (piece.indexOf('\n') === -1 && piece.indexOf('\r') === -1) {
        pos = ci + 1;
        fieldEnded = COMMA;
        return acc === null ? piece : acc + piece;
      }
      return scanUnquotedSlow(p, p, acc);
    }
    const ni = text.indexOf('\n', p);
    if (ni !== -1) {
      const piece = text.slice(p, ni);
      if (piece.indexOf('\r') === -1) {
        pos = ni + 1;
        line += 1;
        fieldEnded = BREAK;
        return acc === null ? piece : acc + piece;
      }
      if (piece.indexOf('\r') === piece.length - 1) {
        // The only CR is the trailing half of a CRLF: the record ends here.
        const v = piece.slice(0, -1);
        pos = ni + 1;
        line += 1;
        fieldEnded = BREAK;
        return acc === null ? v : acc + v;
      }
      return scanUnquotedSlow(p, p, acc);
    }
    const piece = text.slice(p, n);
    if (piece.indexOf('\r') === -1) {
      pos = n;
      fieldEnded = END;
      return acc === null ? piece : acc + piece;
    }
    return scanUnquotedSlow(p, p, acc);
  }

  // The careful unquoted reader: like scanUnquoted, but a lone CR outside
  // quotes is dropped (with a stray_cr error) and the field goes on after
  // it, and a CRLF ends the record. Only reached when a CR or a line break
  // sits inside the field, so it is rare.
  function scanUnquotedSlow(seg, p, acc) {
    for (;;) {
      const ci = text.indexOf(',', p);
      const ni = text.indexOf('\n', p);
      const ri = text.indexOf('\r', p);
      if (ci !== -1 && (ni === -1 || ci < ni) && (ri === -1 || ci < ri)) {
        pos = ci + 1;
        fieldEnded = COMMA;
        return acc === null ? text.slice(seg, ci) : acc + text.slice(seg, ci);
      }
      if (ni !== -1 && (ri === -1 || ni < ri)) {
        pos = ni + 1;
        line += 1;
        fieldEnded = BREAK;
        return acc === null ? text.slice(seg, ni) : acc + text.slice(seg, ni);
      }
      if (ri === -1) {
        pos = n;
        fieldEnded = END;
        return acc === null ? text.slice(seg, n) : acc + text.slice(seg, n);
      }
      if (text.charCodeAt(ri + 1) === 10) {
        pos = ri + 2;
        line += 1;
        fieldEnded = BREAK;
        return acc === null ? text.slice(seg, ri) : acc + text.slice(seg, ri);
      }
      // A lone CR: dropped, with an error; the field goes on after it.
      pushError('stray_cr');
      acc = acc === null ? text.slice(seg, ri) : acc + text.slice(seg, ri);
      p = ri + 1;
      seg = ri + 1;
    }
  }

  // Finishes a record's fields: header, or a row padded/cut to the width.
  function pushRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Record fast path: the next line holds no quote and no stray CR, so the
    // record ends at its LF (or at the end of the text) and is one split.
    const nl = text.indexOf('\n', pos);
    const recEnd = nl === -1 ? n : nl;
    const q0 = text.indexOf('"', pos);
    if (q0 === -1 || q0 >= recEnd) {
      const r0 = text.indexOf('\r', pos);
      if (r0 === -1 || r0 >= recEnd || (r0 === recEnd - 1 && nl !== -1)) {
        let end = recEnd;
        if (nl !== -1 && r0 === recEnd - 1) end = recEnd - 1; // trailing CR of a CRLF
        const fields = text.slice(pos, end).split(',');
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
        pushRecord(fields);
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR; read it field by field.
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (!quoted) {
        fields.push(scanUnquoted(pos, null));
        continue;
      }
      // A quoted field: find its closing quote, skipping doubled quotes.
      const open = pos;
      let doubled = false;
      let q = text.indexOf('"', open + 1);
      while (q !== -1 && text.charCodeAt(q + 1) === 34) {
        doubled = true;
        q = text.indexOf('"', q + 2);
      }
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. (line is still the open line:
        // nothing above moved it.)
        pushError('unterminated_quote');
        fields.push(scanUnquoted(open + 1, '"'));
        continue;
      }
      let value = text.slice(open + 1, q);
      if (doubled) value = value.replaceAll('""', '"');
      if (value.indexOf('\r') !== -1) {
        value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      }
      if (value.indexOf('\n') !== -1) {
        // Every LF in the normalised value is one line break inside quotes.
        let breaks = 0;
        let idx = value.indexOf('\n');
        while (idx !== -1) {
          breaks += 1;
          idx = value.indexOf('\n', idx + 1);
        }
        line += breaks;
      }
      pos = q + 1;
      if (pos >= n) {
        fieldEnded = END;
        fields.push(value);
        continue;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fieldEnded = COMMA;
        fields.push(value);
      } else if (c === 10) {
        pos += 1;
        line += 1;
        fieldEnded = BREAK;
        fields.push(value);
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fieldEnded = BREAK;
        fields.push(value);
      } else {
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break.
        const before = value.length;
        fields.push(scanUnquoted(pos, value));
        if (fields[fields.length - 1].length > before) pushError('quote_junk');
      }
    } while (fieldEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    pushRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
