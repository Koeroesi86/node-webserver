import createCompressionBudget from './create-compression-budget';

describe('createCompressionBudget', () => {
  it('counts the places taken and gives them back', () => {
    const budget = createCompressionBudget();
    const releaseFirst = budget.acquire();
    const releaseSecond = budget.acquire();

    expect(budget.getActive()).toBe(2);
    releaseFirst();
    expect(budget.getActive()).toBe(1);
    releaseSecond();
    expect(budget.getActive()).toBe(0);
  });

  it('gives a place back only once', () => {
    const budget = createCompressionBudget();
    const release = budget.acquire();
    budget.acquire();

    release();
    release();

    expect(budget.getActive()).toBe(1);
  });

  it('does not share places between budgets', () => {
    const first = createCompressionBudget();
    const second = createCompressionBudget();

    first.acquire();

    expect(second.getActive()).toBe(0);
  });
});
