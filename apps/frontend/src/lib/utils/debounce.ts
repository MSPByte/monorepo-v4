export interface Debounced<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced as Debounced<T>;
}
