function getFileType(resource) {
    const hashed = resource.hashed ?? ''
    if (hashed.endsWith('.js')) return 'js';
    if (hashed.endsWith('.css')) return 'css';
}

function createScript(cdn, resource, fallback = '/') {
    const urls = [cdn + '/' + resource.hashed, fallback + resource.hashed];

    let index = 0;
    let script;
    const next = (resolve, reject) => {
        if (index >= urls.length) return

        const url = urls[index++];

        script = document.createElement('script');
        script.src = url;
        script.type = 'module'
        if (resource.mode === 'async') script.async = true;
        else if (resource.mode === 'defer') script.defer = true;

        script.onload = () => resolve && resolve(script);
        script.onerror = () => {
            script.remove();
            next(resolve, reject)
        }

        if (resource.critical) document.body.insertBefore(script, document.body.firstChild);
        else document.body.appendChild(script);
    }

    resource.critical ? new Promise((resolve, reject) => next(resolve, reject)) : next();
}

function createLink(cdn, resource, fallback = '/') {
    const urls = [cdn + '/' + resource.hashed, fallback + resource.hashed];

    let index = 0;
    let link;

    const next = () => {
        const url = urls[index++];

        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;

        link.onerror = () => {
            link.remove()
            next()
        }

        document.head.appendChild(link);
    }

    next()
}

async function getAliveCdn() {
    try {
        const res = await fetch('http://localhost:3000/api/alive-cdn.json', { cache: 'no-store' });
        const data = await res.json();
        return data.url ?? 'http://localhost:3001';
    } catch (e) {
        return 'http://localhost:3001'
    }
}

async function getManifest() {
    try {
        const res = await fetch('http://localhost:3000/api/manifest.json', { cache: 'no-store' });
        const data = await res.json();
        return data ?? [];
    } catch (e) {
        return [];
    }
}

(async function dynload() {
    const [cdn, resources] = await Promise.all([getAliveCdn(), getManifest()])

    const criticals = resources.filter(r => r.critical);
    const optionals = resources.filter(r => !r.critical);

    for (const resource of criticals) {
        try {
            const type = getFileType(resource);
            if (type === 'js') await createScript(cdn, resource);
            else if (type === 'css') await createLink(cdn, resource);
        } catch (e) { }
    }

    optionals.forEach(resource => {
        try {
            const type = getFileType(resource);
            if (type === 'js') createScript(cdn, resource);
            else if (type === 'css') createLink(cdn, resource);
        } catch (e) { }
    });
})()