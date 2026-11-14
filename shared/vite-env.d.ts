declare module "*.yaml?raw" {
    const content: string;
    export default content;
}

declare module "@soundtouchjs/audio-worklet/processor?url" {
    const url: string
    export default url
}