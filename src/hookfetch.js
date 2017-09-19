function hookFetchCode () {
  // let self = this
  const convertHeader = function convertHeader (headers) {
    let out = new Headers()
    for (let key of Object.keys(headers)) {
      out.set(key, headers[key])
    }
    return out
  }
  const hideHookStack = stack => {
    return stack.replace(/^\s*at\s.*?hookfetch\.js:\d.*$\n/mg, '')
  }
  const base64ToUint8 = (b64) => {
    const s = atob(b64)
    const length = s.length
    let ret = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
      ret[i] = s.charCodeAt(i)
    }
    return ret
  }
  class WrapPort {
    constructor (port) {
      this.curMethod = ''
      this.curResolve = null
      this.curReject = null
      this.stack = ''
      this.port = port
      this.lastDone = true

      port.onMessage.addListener(msg => this.onMessage(msg))
    }
    post (method, args) {
      if (!this.lastDone) {
        throw new Error('Last post is not done')
      }
      this.stack = new Error().stack
      return new Promise((resolve, reject) => {
        this.lastDone = false
        this.curMethod = method
        this.curResolve = resolve
        this.curReject = reject
        this.port.postMessage({
          method: method,
          args: args
        })
      })
    }
    onMessage (msg) {
      if (msg.method === this.curMethod) {
        if (msg.err) {
          let err = new Error(msg.err.message)
          err.oriName = msg.err.name
          err.stack = hideHookStack(this.stack)
          // console.log('fetch err', err)
          this.curReject.call(null, err)
        } else {
          this.curResolve.apply(null, msg.args)
        }
        this.curResolve = null
        this.curReject = null
        this.lastDone = true
      } else {
        console.error('wtf?')
      }
    }
  }
  class PortReader {
    constructor (port) {
      this.port = port
      this.hasReader = false
    }
    _requireReader () {
      if (this.hasReader) {
        return Promise.resolve()
      } else {
        return this.port.post('body.getReader').then(() => this.hasReader = true)
      }
    }
    read () {
      return this._requireReader()
        .then(() => this.port.post('reader.read'))
        .then(r => {
          if (r.done == false) {
            r.value = base64ToUint8(r.value)
          }
          return r
        })
    }
    cancel () {
      return this._requireReader().then(() => this.port.post('reader.cancel'))
    }
  }
  class PortBody {
    constructor (port) {
      this.port = port
    }
    getReader () {
      return new PortReader(this.port)
    }
  }
  class PortFetch {
    constructor () {
      this.port = new WrapPort(chrome.runtime.connect({name: 'fetch'}))
    }
    fetch (...args) {
      return this.port.post('fetch', args).then(r => {
        r.json = () => this.port.post('json')
        r.arrayBuffer = () => this.port.post('arrayBuffer').then(buf => {
          return new Uint8Array(buf).buffer
        })
        r.headers = convertHeader(r.headers)
        r.body = new PortBody(this.port)
        return r
      })
    }
  }
  const bgFetch = function bgFetch (...args) {
    const fetch = new PortFetch()
    return fetch.fetch(...args)
  }
  function hookFetch () {
    if (fetch !== bgFetch) {
      fetch = bgFetch
    }
  }
  const oldBlob = Blob
  const newBlob = function newBlob(a, b) {
    a[0] = `(${hookFetchCode})();${a[0]}`
    console.log('new blob', a, b)
    return new oldBlob(a, b)
  }
  // if(self.document !== undefined) {
  //   if (self.Blob !== newBlob) {
  //     self.Blob = newBlob
  //   }
  // }

  hookFetch()
}
function isFirefox () {
  return /Firefox/.test(navigator.userAgent)
}
if (!isFirefox()) {
  hookFetchCode()
}
