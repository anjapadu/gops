#!/usr/bin/env node
const fs = require('fs');
const notifier = require('node-notifier');
const shell = require('../utils');
let currentDir = process.cwd();
var childProcess = require('child_process').exec;

async function main() {
    let command = process.argv[2];
    switch (command) {
        case 'image':
            let rawdata;
            try {
                rawdata = fs.readFileSync(currentDir + '/_details.json');
            } catch (e) {
                console.log('No hay archivo _details.json');
                console.log('---- PARA INICIAR ----')
                console.log('----- gops init ------')
                console.log('----------------------')
                process.exit()
            }
            let projectData = JSON.parse(rawdata);
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
                if (err) console.log('ERROR ', err);
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
                            if (item.indexOf(newTag.split(':')[1]) > -1 && (item.indexOf(newTag.split(':')[0]) > -1 && item.indexOf(newTag.split(':')[0] > newTag.length))) {
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
                            childProcess(`scp -r -i ~/.ssh/id_gustavo.pub chart/* kb1.quanticotrends.com:/home/ubuntu/kubecode/${projectData.namespace}/`, function (error, stdout, stderr) {
                                console.log('UPGRADING HELM...');
                                childProcess(`ssh -i ~/.ssh/id_gustavo.pub ubuntu@kb1.quanticotrends.com helm upgrade ${projectData.namespace} /home/ubuntu/kubecode/${projectData.namespace}`, function (error, stdout, stderr) {
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
    }
}
main();
