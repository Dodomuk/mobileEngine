import { BINGO_CELLS, BINGO_CELL_MAX, BINGO_SIZE, checkBoard, completedLines } from '../../../shared/bingo.ts';

// 5×5 빙고판. 칸 채우기(입력) 모드와 게임(표시·선택) 모드를 오간다.
// 입력 중 포커스가 날아가지 않도록, 모드가 바뀔 때만 칸을 다시 만든다.
export type BoardMode = 'empty' | 'fill' | 'locked' | 'play';

export interface BoardState {
  mode: BoardMode;
  cells: string[];
  marked: boolean[];
  selectable: boolean;        // 내 차례라 칸을 고를 수 있는지
  selected: number | null;
}

export class BingoBoard {
  readonly el = document.createElement('div');
  private mode: BoardMode | null = null;
  private cellEls: HTMLElement[] = [];
  private inputs: HTMLInputElement[] = [];
  private prevMarked: boolean[] = Array(BINGO_CELLS).fill(false);

  constructor(
    private onInput: (cells: string[]) => void,
    private onSelect: (index: number) => void,
  ) {
    this.el.className = 'bingo-board';
  }

  values(): string[] {
    return this.inputs.map((i) => i.value);
  }

  render(state: BoardState): void {
    if (state.mode !== this.mode) this.build(state);
    this.mode = state.mode;

    if (state.mode === 'fill') {
      const problems = checkBoard(this.values());
      const dup = new Set(problems.filter((p) => p.reason === 'DUPLICATE').map((p) => p.index));
      this.inputs.forEach((input, i) => input.parentElement!.classList.toggle('dup', dup.has(i)));
      return;
    }
    if (state.mode !== 'play' && state.mode !== 'locked') return;

    const lineCells = new Set(completedLines(state.marked).flat());
    this.cellEls.forEach((cell, i) => {
      cell.querySelector('.bingo-cell-text')!.textContent = state.cells[i] ?? '';
      const marked = state.marked[i];
      cell.classList.toggle('marked', marked);
      cell.classList.toggle('in-line', lineCells.has(i));
      cell.classList.toggle('selectable', state.selectable && !marked);
      cell.classList.toggle('selected', state.selected === i);
      // 방금 지워진 칸은 도장 찍히는 애니메이션
      if (marked && !this.prevMarked[i]) {
        cell.classList.remove('just-marked');
        void cell.offsetWidth;
        cell.classList.add('just-marked');
      }
      (cell as HTMLButtonElement).disabled = !(state.selectable && !marked);
    });
    this.prevMarked = [...state.marked];
  }

  private build(state: BoardState): void {
    this.el.replaceChildren();
    this.cellEls = [];
    this.inputs = [];
    this.el.dataset.mode = state.mode;
    if (state.mode === 'empty') {
      const p = document.createElement('p');
      p.className = 'bingo-board-empty';
      p.textContent = '관리자가 주제를 내면 25칸을 채울 수 있어요';
      this.el.append(p);
      return;
    }
    for (let i = 0; i < BINGO_CELLS; i++) {
      if (state.mode === 'fill') {
        const wrap = document.createElement('label');
        wrap.className = 'bingo-cell fill';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = BINGO_CELL_MAX;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = state.cells[i] ?? '';
        input.setAttribute('aria-label', `${Math.floor(i / BINGO_SIZE) + 1}행 ${(i % BINGO_SIZE) + 1}열`);
        input.enterKeyHint = i === BINGO_CELLS - 1 ? 'done' : 'next';
        input.addEventListener('input', () => this.onInput(this.values()));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.inputs[i + 1]?.focus();
          }
        });
        wrap.append(input);
        this.inputs.push(input);
        this.el.append(wrap);
      } else {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'bingo-cell';
        cell.innerHTML = '<span class="bingo-cell-text"></span><span class="bingo-stamp" aria-hidden="true"></span>';
        cell.addEventListener('click', () => this.onSelect(i));
        this.cellEls.push(cell);
        this.el.append(cell);
      }
    }
    this.prevMarked = [...state.marked];
  }
}
