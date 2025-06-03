const e=["error","warn","info","debug"];class n{constructor(e){this.level=e}log(n,o){e.indexOf(this.level)<e.indexOf(n)||console[n](o)}}var o=(e="warn")=>new n(e);export{n as Logger,o as default};
