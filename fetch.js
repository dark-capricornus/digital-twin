const https = require('https');
const fs = require('fs');

const url1 = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzM0MjU5MTg3YzQwYzQyODM4YjFhN2I3ODIyYzQ4MGU2EgsSBxCi2LPdxg0YAZIBJAoKcHJvamVjdF9pZBIWQhQxNzEyNTczNzg0Mzc2NzYyMTY3OA&filename=&opi=89354086";
const url2 = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sX2Y3M2Q1YTkxMjVkNDRkMjhhYjlkOTc4MWZjNTIzNzAwEgsSBxCi2LPdxg0YAZIBJAoKcHJvamVjdF9pZBIWQhQxNzEyNTczNzg0Mzc2NzYyMTY3OA&filename=&opi=89354086";

https.get(url1, (res) => {
    const file = fs.createWriteStream('ui1.html');
    res.pipe(file);
    file.on('finish', () => file.close());
}).on('error', console.error);

https.get(url2, (res) => {
    const file = fs.createWriteStream('ui2.html');
    res.pipe(file);
    file.on('finish', () => file.close());
}).on('error', console.error);
