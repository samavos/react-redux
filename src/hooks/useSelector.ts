//import * as React from 'react'
import { React } from '../utils/react'

import type { ReactReduxContextValue } from '../components/Context'
import { ReactReduxContext } from '../components/Context'
import type { EqualityFn, NoInfer } from '../types'
import {
  createReduxContextHook,
  useReduxContext as useDefaultReduxContext,
} from './useReduxContext'
import type { Trace } from '@internal/exports'
import { useEffect } from 'react'

/**
 * The frequency of development mode checks.
 *
 * @since 8.1.0
 * @internal
 */
export type DevModeCheckFrequency = 'never' | 'once' | 'always'

/**
 * Represents the configuration for development mode checks.
 *
 * @since 9.0.0
 * @internal
 */
export interface DevModeChecks {
  /**
   * Overrides the global stability check for the selector.
   * - `once` - Run only the first time the selector is called.
   * - `always` - Run every time the selector is called.
   * - `never` - Never run the stability check.
   *
   * @default 'once'
   *
   * @since 8.1.0
   */
  stabilityCheck: DevModeCheckFrequency

  /**
   * Overrides the global identity function check for the selector.
   * - `once` - Run only the first time the selector is called.
   * - `always` - Run every time the selector is called.
   * - `never` - Never run the identity function check.
   *
   * **Note**: Previously referred to as `noopCheck`.
   *
   * @default 'once'
   *
   * @since 9.0.0
   */
  identityFunctionCheck: DevModeCheckFrequency
}

export interface UseSelectorOptions<Selected = unknown> {
  equalityFn?: EqualityFn<Selected>

  /**
   * `useSelector` performs additional checks in development mode to help
   * identify and warn about potential issues in selector behavior. This
   * option allows you to customize the behavior of these checks per selector.
   *
   * @since 9.0.0
   */
  devModeChecks?: Partial<DevModeChecks>
}

/**
 * Represents a custom hook that allows you to extract data from the
 * Redux store state, using a selector function. The selector function
 * takes the current state as an argument and returns a part of the state
 * or some derived data. The hook also supports an optional equality
 * function or options object to customize its behavior.
 *
 * @template StateType - The specific type of state this hook operates on.
 *
 * @public
 */
export interface UseSelector<StateType = unknown> {
  /**
   * A function that takes a selector function as its first argument.
   * The selector function is responsible for selecting a part of
   * the Redux store's state or computing derived data.
   *
   * @param selector - A function that receives the current state and returns a part of the state or some derived data.
   * @param equalityFnOrOptions - An optional equality function or options object for customizing the behavior of the selector.
   * @returns The selected part of the state or derived data.
   *
   * @template TState - The specific type of state this hook operates on.
   * @template Selected - The type of the value that the selector function will return.
   */
  <TState extends StateType = StateType, Selected = unknown>(
    selector: (state: TState) => Selected,
    equalityFnOrOptions?: EqualityFn<Selected> | UseSelectorOptions<Selected>,
    name?: string,
  ): Selected

  /**
   * Creates a "pre-typed" version of {@linkcode useSelector useSelector}
   * where the `state` type is predefined.
   *
   * This allows you to set the `state` type once, eliminating the need to
   * specify it with every {@linkcode useSelector useSelector} call.
   *
   * @returns A pre-typed `useSelector` with the state type already defined.
   *
   * @example
   * ```ts
   * export const useAppSelector = useSelector.withTypes<RootState>()
   * ```
   *
   * @template OverrideStateType - The specific type of state this hook operates on.
   *
   * @since 9.1.0
   */
  withTypes: <
    OverrideStateType extends StateType,
  >() => UseSelector<OverrideStateType>
}

const refEquality: EqualityFn<any> = (a, b) => a === b

/**
 * Hook factory, which creates a `useSelector` hook bound to a given context.
 *
 * @param {React.Context} [context=ReactReduxContext] Context passed to your `<Provider>`.
 * @returns {Function} A `useSelector` hook bound to the specified context.
 */
export function createSelectorHook(
  context: React.Context<ReactReduxContextValue<
    any,
    any
  > | null> = ReactReduxContext,
): UseSelector {
  const useReduxContext =
    context === ReactReduxContext
      ? useDefaultReduxContext
      : createReduxContextHook(context)

  const useSelector = <TState, Selected>(
    selector: (state: TState) => Selected,
    equalityFnOrOptions:
      | EqualityFn<NoInfer<Selected>>
      | UseSelectorOptions<NoInfer<Selected>> = {},
    name?: string,
  ): Selected => {
    const { equalityFn = refEquality, devModeChecks = {} } =
      typeof equalityFnOrOptions === 'function'
        ? { equalityFn: equalityFnOrOptions }
        : equalityFnOrOptions
    if (process.env.NODE_ENV !== 'production') {
      if (!selector) {
        throw new Error(`You must pass a selector to useSelector`)
      }
      if (typeof selector !== 'function') {
        throw new Error(`You must pass a function as a selector to useSelector`)
      }
      if (typeof equalityFn !== 'function') {
        throw new Error(
          `You must pass a function as an equality function to useSelector`,
        )
      }
    }

    const {
      store,
      subscription,
      getServerState,
      stabilityCheck,
      identityFunctionCheck,
      traceFactory,
    } = useReduxContext()

    const trace = React.useRef<{ 
      trace: Trace, 
      selector: (state: TState) => Selected,
      name?: string,
    }>();

    if (trace.current && 
         (trace.current.selector !== selector || 
          trace.current.name !== name)) {
      trace.current?.trace.onSelectorUnmount?.();
      trace.current = undefined;
    }

    if (!trace.current && traceFactory) {
      trace.current = { trace: traceFactory(name), selector, name };
    }

    useEffect(() => {
      return () => {
        trace.current?.trace.onSelectorUnmount?.();
        trace.current = undefined;
      }
    }, []);

    const firstRun = React.useRef(true)

    const wrappedSelector = React.useCallback<typeof selector>(
      {
        [selector.name](state: TState) {
          const selected = selector(state)
          if (process.env.NODE_ENV !== 'production') {
            const {
              identityFunctionCheck: finalIdentityFunctionCheck,
              stabilityCheck: finalStabilityCheck,
            } = {
              stabilityCheck,
              identityFunctionCheck,
              ...devModeChecks,
            }
            if (
              finalStabilityCheck === 'always' ||
              (finalStabilityCheck === 'once' && firstRun.current)
            ) {
              const toCompare = selector(state)
              if (!equalityFn(selected, toCompare)) {
                let stack: string | undefined = undefined
                try {
                  throw new Error()
                } catch (e) {
                  // eslint-disable-next-line no-extra-semi
                  ;({ stack } = e as Error)
                }
                console.warn(
                  'Selector ' +
                    (selector.name || 'unknown') +
                    ' returned a different result when called with the same parameters. This can lead to unnecessary rerenders.' +
                    '\nSelectors that return a new reference (such as an object or an array) should be memoized: https://redux.js.org/usage/deriving-data-selectors#optimizing-selectors-with-memoization',
                  {
                    state,
                    selected,
                    selected2: toCompare,
                    stack,
                  },
                )
              }
            }
            if (
              finalIdentityFunctionCheck === 'always' ||
              (finalIdentityFunctionCheck === 'once' && firstRun.current)
            ) {
              // @ts-ignore
              if (selected === state) {
                let stack: string | undefined = undefined
                try {
                  throw new Error()
                } catch (e) {
                  // eslint-disable-next-line no-extra-semi
                  ;({ stack } = e as Error)
                }
                console.warn(
                  'Selector ' +
                    (selector.name || 'unknown') +
                    ' returned the root state when called. This can lead to unnecessary rerenders.' +
                    '\nSelectors that return the entire state are almost certainly a mistake, as they will cause a rerender whenever *anything* in state changes.',
                  { stack },
                )
              }
            }
            if (firstRun.current) firstRun.current = false
          }
          return selected
        },
      }[selector.name],
      [selector, stabilityCheck, devModeChecks.stabilityCheck],
    )

    const selectedState = useSyncExternalStoreWithSelector(
      subscription.addNestedSub,
      store.getState,
      getServerState || store.getState,
      wrappedSelector,
      equalityFn,
      trace.current?.trace,
    )

    React.useDebugValue(selectedState)

    return selectedState
  }

  Object.assign(useSelector, {
    withTypes: () => useSelector,
  })

  return useSelector as UseSelector
}

/**
 * A hook to access the redux store's state. This hook takes a selector function
 * as an argument. The selector is called with the store state.
 *
 * This hook takes an optional equality comparison function as the second parameter
 * that allows you to customize the way the selected state is compared to determine
 * whether the component needs to be re-rendered.
 *
 * @param {Function} selector the selector function
 * @param {Function=} equalityFn the function that will be used to determine equality
 *
 * @returns {any} the selected state
 *
 * @example
 *
 * import React from 'react'
 * import { useSelector } from 'react-redux'
 *
 * export const CounterComponent = () => {
 *   const counter = useSelector(state => state.counter)
 *   return <div>{counter}</div>
 * }
 */
export const useSelector = /*#__PURE__*/ createSelectorHook()




export type uSES = typeof React.useSyncExternalStore
export type uSESWS = typeof useSyncExternalStoreWithSelector


// Copied from use-sync-external-store
function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
  trace?: Trace
): Selection {
  // Use this to track the rendered snapshot.
  type refType = { hasValue: boolean, value: Selection | null };
  const instRef = React.useRef<refType|null>(null);
  let inst: refType | null = null;

  if (instRef.current === null) {
    inst = {
      hasValue: false,
      value: null
    };
    instRef.current = inst;
  } else {
    inst = instRef.current;
  }

  const subscribeWrapper = React.useCallback((onStoreChange: () => void): () => void => {
    trace?.onSubscribe?.();
    const cleanup = subscribe(() => {
      trace?.onStoreChange?.();
      onStoreChange();
    });

    return () => {
      trace?.onSubscribeCleanup?.();
      cleanup();
    }
  }, [trace]);

  const [getSelection, getServerSelection] = React.useMemo(function () {
    // Track the memoized state using closure variables that are local to this
    // memoized instance of a getSnapshot function. Intentionally not using a
    // useRef hook, because that state would be shared across all concurrent
    // copies of the hook/component.
    let hasMemo = false;
    let memoizedSnapshot: Snapshot | null = null;
    let memoizedSelection: Selection | null = null;

    const memoizedSelector = function (nextSnapshot: Snapshot) {
      if (!hasMemo) {
        // The first time the hook is called, there is no memoized result.
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;

        trace?.onSelectorCallStart?.();
        const _nextSelection = selector(nextSnapshot);
        trace?.onSelectorCallEnd?.();

        if (isEqual !== undefined) {
          // Even if the selector has changed, the currently rendered selection
          // may be equal to the new selection. We should attempt to reuse the
          // current value if possible, to preserve downstream memoizations.
          if (inst?.hasValue) {
            const currentSelection = inst.value;
            const eq = isEqual(currentSelection!, _nextSelection);
            trace?.onIsEqualCall?.(eq);

            if (eq) {
              memoizedSelection = currentSelection;
              return currentSelection;
            }
          }
        }

        memoizedSelection = _nextSelection;
        return _nextSelection;
      } // We may be able to reuse the previous invocation's result.


      // We may be able to reuse the previous invocation's result.
      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;

      const isEq = Object.is(prevSnapshot, nextSnapshot);

      trace?.onObjectIsEqualCall?.(isEq);

      if (isEq) {
        // The snapshot is the same as last time. Reuse the previous selection.
        return prevSelection;
      } // The snapshot has changed, so we need to compute a new selection.


      // The snapshot has changed, so we need to compute a new selection.
      trace?.onSelectorCallStart?.();
      const nextSelection = selector(nextSnapshot); // If a custom isEqual function is provided, use that to check if the data
      trace?.onSelectorCallEnd?.();
      // has changed. If it hasn't, return the previous selection. That signals
      // to React that the selections are conceptually equal, and we can bail
      // out of rendering.

      // If a custom isEqual function is provided, use that to check if the data
      // has changed. If it hasn't, return the previous selection. That signals
      // to React that the selections are conceptually equal, and we can bail
      // out of rendering.

      if (isEqual !== undefined) {
        const eq = isEqual(prevSelection!, nextSelection);
        trace?.onIsEqualCall?.(eq);
        if (eq)
          return prevSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    }; // Assigning this to a constant so that Flow knows it can't change.

    // Assigning this to a constant so that Flow knows it can't change.
    const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;

    const getSnapshotWithSelector = function () {
      trace?.onGetSnapshot?.();
      return memoizedSelector(getSnapshot());
    };

    const getServerSnapshotWithSelector = maybeGetServerSnapshot === null ? undefined : function () {
      return memoizedSelector(maybeGetServerSnapshot());
    };
    return [getSnapshotWithSelector, getServerSnapshotWithSelector];
  }, [getSnapshot, getServerSnapshot, selector, isEqual, trace]);

  const value = React.useSyncExternalStore(subscribeWrapper, getSelection!, getServerSelection);

  React.useEffect(function () {
    if (inst) {
      inst.hasValue = true;
      inst.value = value;
    }
  }, [value]);
  
  React.useDebugValue(value);
  
  return value!;
}
