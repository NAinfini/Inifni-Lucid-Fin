export const vi = {
  fn<T extends (...args: never[]) => unknown>(implementation?: T) {
    const callable = (...args: Parameters<T>): ReturnType<T> => {
      callable.mock.calls.push(args);
      return implementation?.(...args) as ReturnType<T>;
    };
    callable.mock = { calls: [] as Parameters<T>[] };
    return callable;
  },
};
