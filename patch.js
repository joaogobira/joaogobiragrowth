const fs = require('fs');

let src = fs.readFileSync('studio.html', 'utf8');

const target = `function rteChangeFontSize(multiplier) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.fontSize = multiplier + 'em';
  try {
    range.surroundContents(span);
  } catch (e) {
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
}`;

const replacement = `function rteChangeFontSize(multiplier) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  
  if (sel.isCollapsed) {
    const node = sel.anchorNode;
    if (node) {
      let el = node.nodeType === 3 ? node.parentNode : node;
      const ce = el.closest('[contenteditable="true"]');
      if (ce) {
        let currentSize = window.getComputedStyle(ce).fontSize;
        let px = parseFloat(currentSize);
        if (!isNaN(px)) {
          ce.style.fontSize = (px * multiplier) + 'px';
        }
      }
    }
    return;
  }
  
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.fontSize = multiplier + 'em';
  try {
    range.surroundContents(span);
  } catch (e) {
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
}

// Previne perda de foco ao clicar nos botões do editor
document.addEventListener('mousedown', e => {
  if (e.target.closest('.rte-btn')) {
    e.preventDefault();
  }
});`;

// Try exact match
let newSrc = src.replace(target, replacement);

// Try with CRLF
if (newSrc === src) {
  newSrc = src.replace(target.replace(/\n/g, '\r\n'), replacement.replace(/\n/g, '\r\n'));
}

if (newSrc === src) {
  console.log("Failed to replace");
} else {
  fs.writeFileSync('studio.html', newSrc);
  console.log("Success");
}
