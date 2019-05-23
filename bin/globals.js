#!/usr/bin/env node
const fs = require('fs');
const notifier = require('node-notifier');
const shell = require('../utils');
let currentDir = process.cwd();
var childProcess = require('child_process').exec;
// var prompt = require('prompt');
const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
})

const namespaceQuestion = () => {
    return new Promise((resolve, reject) => {
        rl.question('Project container registry namespace: ', (answer) => {
            resolve(answer)
        })
    })
}
const imageQuestion = () => {
    return new Promise((resolve, reject) => {
        rl.question('Project image name: ', (answer) => {
            resolve(answer)
        })
    })
}
const versionQuestion = () => {
    return new Promise((resolve, reject) => {
        rl.question('Project version (Will be used as tag): ', (answer) => {
            resolve(answer)
        })
    })
}
const registryQuestion = () => {
    return new Promise((resolve, reject) => {
        rl.question('Registry endpoint ( registry.ng.bluemix.net/): ', (answer) => {
            resolve(answer)
        })
    })
}
const sshQuestion = (question = 'Public key route ( /Users/username/.ssh/name.pub): ') => {
    return new Promise((resolve, reject) => {
        rl.question(question, (answer) => {
            if (!answer || answer.trim().length <= 3) {
                resolve(sshQuestion('Please add a valid route ( /Users/username/.ssh/name.pub): '));
            } else {
                if (!fs.existsSync(answer)) {
                    console.log('Public key route invalid.');
                    resolve(sshQuestion("Please add a valid route ( /Users/username/.ssh/name.pub): "))
                } else {
                    resolve(answer)
                }
            }
        })
    })
}


const checkSshKey = () => {
    return new Promise(async (resolve, reject) => {
        let rawGlobals;
        try {
            rawGlobals = fs.readFileSync(__dirname + '/global.json');
            rawGlobals = JSON.parse(rawGlobals);
            if (fs.existsSync(rawGlobals.publicKey))
                resolve(rawGlobals.publicKey);
            else
                throw new Error()

        } catch (e) {
            let pq = await sshQuestion('You dont have a ssh key associated. Please add a route for it ( /Users/username/.ssh/name.pub): ');
            rl.close();
            rawGlobals = {
                publicKey: pq
            }
            fs.writeFileSync(__dirname + '/global.json', JSON.stringify(rawGlobals, null, 4));
            resolve(rawGlobals.publicKey)
        }
    })
}


async function main() {
    let command = process.argv[2];

    if (command == 'config') {
        await checkSshKey();
        process.exit();
    }

    let rawdata;
    let projectData;
    try {
        rawdata = fs.readFileSync(currentDir + '/_details.json');
        projectData = JSON.parse(rawdata);
    } catch (e) {
        console.log('No hay archivo _details.json');
        let nq = await namespaceQuestion();
        let iq = await imageQuestion();
        let vq = await versionQuestion();
        let rq = await registryQuestion();
        rl.close()
        projectData = {
            "namespace": nq.trim(),
            "image": iq.trim(),
            "version": vq.trim(),
            "tag": vq.trim(),
            "registryUrl": !rq || rq.trim() == '' ? 'registry.ng.bluemix.net/' : rq.trim()
        }
        fs.writeFileSync(`${currentDir}/_details.json`, JSON.stringify(projectData, null, 4));
    }

    const sshKey = await checkSshKey();
    switch (command) {

        case 'image':
            let versionArray = projectData.version.split('.');
            let changeToDo = process.argv[3];
            switch (changeToDo) {
                case 'big':
                    versionArray[0] = parseInt(versionArray[0]) + 1;
                    versionArray[1] = 0;
                    versionArray[2] = 0;
                    break;
                case 'medium':
                    versionArray[1] = parseInt(versionArray[1]) + 1;
                    versionArray[2] = 0
                    break;
                default:
                    versionArray[2] = parseInt(versionArray[2]) + 1;
            }
            let newVersion = versionArray.join('.')
            let newTag = projectData.registryUrl + projectData.namespace + '/' + projectData.image + ':' + newVersion;
            shell.series([
                'docker build --tag ' + newTag + ' .',
                'docker push ' + newTag
            ], async function (err) {
                if (err) {
                    console.log('ERROR ', err);
                    process.exit();
                }
                notifier.notify(`La imagen ${projectData.namespace}/${projectData.image}:${newVersion} fue subida exitosamente.`);
                console.log(`La imagen ${projectData.namespace}/${projectData.image}:${newVersion} fue subida exitosamente.`)
                projectData['version'] = newVersion;
                projectData['tag'] = newVersion;
                let path = currentDir + '/_details.json';
                let data = JSON.stringify(projectData, null, 4);
                //fs.writeFileSync(path, data)
                let itemTagged;
                console.log('WAITING FOR IMAGE TO FINISH SCAN...');
                notifier.notify(`STARTING SCANNING...`);
                this.interval = setInterval(() => {
                    require('child_process').exec('ibmcloud cr images', async function (err, stdout, stderr) {
                        let stdoutArray = stdout.split('\n');
                        itemTagged = null;
                        stdoutArray.forEach(item => {
                            // if (item.indexOf(newTag.split(':')[1]) > -1 && (item.indexOf(newTag.split(':')[0]) > -1 && item.indexOf(newTag.split(':')[0] > newTag.length))) {
                            //     itemTagged = item;
                            // }
                            if (item.indexOf(`/${projectData.namespace}/${projectData.image}`) > -1 &&
                                (
                                    item.indexOf(newTag.split(':')[1]) > -1 && item.indexOf(newTag.split(':')[1]) > item.indexOf(`/${projectData.namespace}/${projectData.image}`)
                                )
                            ) {
                                itemTagged = item;
                            }
                        })
                        if (itemTagged.indexOf('Scanning...') == -1) {
                            clearInterval(this.interval);
                            console.log('UPDATING HELM CHART...');
                            const files = await fs.readdirSync(currentDir + '/chart/templates');
                            let replace = new RegExp(`registry\.ng\.bluemix\.net\/${projectData.namespace}\/${projectData.image}\:[v0-9\.]+`)
                            var re = new RegExp(replace, "g");
                            files.forEach(filename => {
                                let fileData = fs.readFileSync(currentDir + '/chart/templates/' + filename, 'utf8');
                                fs.writeFileSync(currentDir + '/chart/templates/' + filename, fileData.replace(re, newTag))
                            })
                            let rawdataChart = fs.readFileSync(currentDir + '/chart/Chart.yaml', 'utf8');
                            let splitedData = rawdataChart.split('\n');
                            splitedData = splitedData.map((line) => {
                                if (line.indexOf('appVersion') > -1) {
                                    return `appVersion: ${newVersion}`;
                                }
                                if (line.indexOf('version') > -1) {
                                    return `version: ${newVersion}`;
                                }
                                return line;
                            })
                            fs.writeFileSync(currentDir + '/chart/Chart.yaml', splitedData.join('\n'));
                            fs.writeFileSync(path, data);
                            console.log('STARTING COPY OF HELM CHART TO SERVER ...');
                            childProcess(`scp -r -i ${sshKey} chart/* kb1.quanticotrends.com:/home/ubuntu/kubecode/${projectData.namespace}/`, function (error, stdout, stderr) {
                                console.log('UPGRADING HELM...');
                                childProcess(`ssh -i ${sshKey} ubuntu@kb1.quanticotrends.com helm upgrade --install ${projectData.namespace} --namespace ${projectData.namespace} /home/ubuntu/kubecode/${projectData.namespace}`, function (error, stdout, stderr) {
                                    console.log(stdout);
                                    console.log('=============================')
                                    console.log('FINALIZO')
                                    notifier.notify(`HELM CHART UPDATED SUCCESSFULLY! :)`);
                                    process.exit();
                                });
                            })
                        }
                    })
                }, 10000);
            });
            break;
        default:
            console.log('Nothing to do');
            process.exit()
    }
}
main();
