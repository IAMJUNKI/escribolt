declare interface Window {
    require: (module: string) => any;
}

declare module '*.png' {
    const src: string;
    export default src;
}
