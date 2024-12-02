import { getCurrentScrollPosition, ScrollPosition } from "./scroll";
import { remove, logger } from "@joker.front/shared";
import { LOGTAG } from "./config";

export type HistoryState = Record<string | number, any> & {
    back: string | null;
    current: string;
    forward: string | null;
    position: number;
    replaced: boolean;
    scroll: ScrollPosition | null;
};

export type HistoryStateValue = string | number | boolean | null | undefined | HistoryState | HistoryState[];

export enum NavigationType {
    pop = "pop",
    push = "push"
}

export enum NavigationDirection {
    back = "back",
    forward = "forward",
    unknown = ""
}

export type NavigationInformation = {
    type: NavigationType;
    direction: NavigationDirection;
    /**
     * 位置偏移量
     */
    delta: number;
};

type NavigationCallBack = (to: string, from: string, information: NavigationInformation) => void;

export interface IRouteHistory {
    readonly base: string;

    readonly location: string;

    readonly state: HistoryState;

    push(to: string, data?: HistoryState): void;

    replace(to: string, data?: HistoryState): void;

    go(delta: number, triggerListeners?: boolean): void;

    listen(callBack: NavigationCallBack): () => void;

    createHref(location: string): string;

    destroy(): void;
}

export class WebHistory implements IRouteHistory {
    location: string;
    state: HistoryState;

    private pauseState: string | null = null;
    private listeners: NavigationCallBack[] = [];
    private teardowns: Array<Function> = [];
    private popstateEvent: any;
    private beforeunloadEvent: any;

    constructor(public base: string = "") {
        this.normalizeBase();

        this.location = this.getCurrentLocation();

        this.state = window.history.state;

        if (!this.state) {
            //初始化无状态时，做replace跳转，初始化数据
            this.changeLocation(
                this.location,
                {
                    back: null,
                    current: this.location,
                    position: history.length - 1,
                    replaced: true,
                    forward: null,
                    scroll: null
                },
                true
            );
        }

        this.initEvent();
    }

    public push(to: string, data?: HistoryState | undefined): void {
        let currentState: HistoryState = Object.assign({}, this.state, history.state, {
            forward: to,
            scroll: getCurrentScrollPosition()
        });

        if (!history.state) {
            logger.warn(LOGTAG, "history.state似乎被手动替换或移除了，该值丢失了。");
        }

        this.changeLocation(currentState.current, currentState, true);

        let newState: HistoryState = Object.assign(
            createState(this.location, to, null),
            { position: currentState.position + 1 },
            data
        );

        this.changeLocation(to, newState, false);

        this.location = to;
    }

    public replace(to: string, data?: HistoryState | undefined): void {
        let newState: HistoryState = Object.assign(
            {},
            history.state,
            createState(this.state.back, to, this.state.forward, true),
            data,
            { position: this.state.position }
        );

        this.changeLocation(to, newState, true);

        this.location = to;
    }

    public go(delta: number, triggerListeners: boolean = true): void {
        if (!triggerListeners) {
            this.pauseState = this.location;
        }

        window.history.go(delta);
    }

    public listen(callBack: NavigationCallBack): () => void {
        this.listeners.push(callBack);

        let teardown = () => {
            remove<NavigationCallBack>(this.listeners, callBack);
        };

        this.teardowns.push(teardown);

        return teardown;
    }

    public createHref(location: string): string {
        return this.base.replace(/^[^#]+#/, "#") + location;
    }

    public destroy(): void {
        for (let teardown of this.teardowns) teardown();

        this.teardowns = [];

        window.removeEventListener("popstate", this.popstateEvent);
        window.removeEventListener("beforeunload", this.beforeunloadEvent);
    }

    private initEvent() {
        this.popstateEvent = this.onPopstateEvent.bind(this);
        this.beforeunloadEvent = this.onBeforeunloadEvent.bind(this);
        window.addEventListener("popstate", this.popstateEvent);
        window.addEventListener("beforeunload", this.beforeunloadEvent, {
            passive: true
        });
    }

    private onPopstateEvent(this: WebHashHistory, data: { state: HistoryState | null }) {
        let state = data.state;
        let to = this.getCurrentLocation();
        let from = this.location;
        let fromState = this.state;

        let delta = 0;

        if (state) {
            this.location = to;
            this.state = state;

            if (this.pauseState && this.pauseState === from) {
                this.pauseState = null;
                return;
            }

            delta = fromState ? state.position - fromState.position : 0;
        } else {
            this.replace(to);
        }

        this.listeners.forEach((m) => {
            m(this.location, from, {
                delta,
                type: NavigationType.pop,
                direction: delta
                    ? delta > 0
                        ? NavigationDirection.forward
                        : NavigationDirection.back
                    : NavigationDirection.unknown
            });
        });
    }

    private onBeforeunloadEvent(this: WebHashHistory) {
        if (!window.history.state) return;

        window.history.replaceState(
            Object.assign({}, window.history.state, {
                scroll: getCurrentScrollPosition()
            }),
            ""
        );
    }

    private changeLocation(to: string, state: HistoryState, replace: boolean): void {
        let hashIndex = this.base.indexOf("#");

        let url = "";
        if (hashIndex > -1) {
            url = this.base.slice(hashIndex) + to;
        } else {
            url = window.location.protocol + "//" + window.location.host + this.base;
            if (url.endsWith("/") && to.startsWith("/")) {
                url += to.substring(1);
            }

            if (url.endsWith("/")) {
                url = url.slice(0, -1);
            }
        }

        try {
            history[replace ? "replaceState" : "pushState"](state, "", url);
            //更新
            this.state = state;
        } catch (e: any) {
            logger.error(LOGTAG, e.message, e);

            location[replace ? "replace" : "assign"](url);
        }
    }

    private getCurrentLocation() {
        let { pathname, search, hash } = location;

        let hashIndex = this.base.indexOf("#");

        if (hashIndex > -1) {
            let sliceIndex = hash.includes(this.base.slice(hashIndex)) ? this.base.slice(hashIndex).length : 1;

            let pathFromHash = hash.slice(sliceIndex);

            if (pathFromHash[0] !== "/") {
                pathFromHash = "/" + pathFromHash;
            }
            return stripBase(pathFromHash, "");
        }

        return stripBase(pathname, this.base) + search + hash;
    }

    private normalizeBase() {
        this.base ||= "/";

        if (this.base.charAt(0) !== "/" && this.base.charAt(0) !== "#") this.base = "/" + this.base;

        this.base.replace(/\/$/, "");
    }
}

export class WebHashHistory extends WebHistory {
    constructor(base?: string) {
        base = location.host ? base || location.pathname + location.search : "";

        if (base.includes("#") === false) {
            base += "#";
        }

        if (base.endsWith("#/") === false && base.endsWith("#") === false) {
            logger.warn(LOGTAG, `该Hash必须以'#'/'#/'结尾：${base}`);
        }

        super(base);
    }
}

function stripBase(pathname: string, base: string): string {
    if (!base || !pathname.toLocaleLowerCase().startsWith(base.toLowerCase())) {
        return pathname;
    }
    return pathname.slice(base.length) || "/";
}

function createState(
    back: string | null,
    current: string,
    forward: string | null,
    replaced: boolean = false,
    scroll: boolean = false
): HistoryState {
    return {
        back,
        current,
        forward,
        replaced,
        position: window.history.length,
        scroll: scroll ? getCurrentScrollPosition() : null
    };
}
