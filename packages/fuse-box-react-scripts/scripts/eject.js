// @remove-file-on-eject
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * Portions Copyright (c) 2016-present, OffGrid Networks
 * 
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
  throw err;
});

const fs = require('fs-extra');
const path = require('path');
const execSync = require('child_process').execSync;
const chalk = require('chalk');
const paths = require('../config/paths');
const createJestConfig = require('./utils/createJestConfig');
const inquirer = require('react-dev-utils/inquirer');
const spawnSync = require('react-dev-utils/crossSpawn').sync;
const os = require('os');

const green = chalk.green;
const cyan = chalk.cyan;

function getGitStatus() {
  try {
    let stdout = execSync(`git status --porcelain`, {
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString();
    return stdout.trim();
  } catch (e) {
    return '';
  }
}

inquirer
  .prompt({
    type: 'confirm',
    name: 'shouldEject',
    message: 'Are you sure you want to eject? This action is permanent.',
    default: false,
  })
  .then(answer => {
    if (!answer.shouldEject) {
      console.log(cyan('Close one! Eject aborted.'));
      return;
    }

    const gitStatus = getGitStatus();
    if (gitStatus) {
      console.error(
        chalk.red(
          'This git repository has untracked files or uncommitted changes:'
        ) +
          '\n\n' +
          gitStatus
            .split('\n')
            .map(line => line.match(/ .*/g)[0].trim())
            .join('\n') +
          '\n\n' +
          chalk.red(
            'Remove untracked files, stash or commit any changes, and try again.'
          )
      );
      process.exit(1);
    }

    console.log('Ejecting...');

    const ownPath = paths.ownPath;
    const appPath = paths.appPath;

    function verifyAbsent(file) {
      if (fs.existsSync(path.join(appPath, file))) {
        console.error(
          `\`${file}\` already exists in your app folder. We cannot ` +
            'continue as you would lose all the changes in that file or directory. ' +
            'Please move or delete it (maybe make a copy for backup) and run this ' +
            'command again.'
        );
        process.exit(1);
      }
    }

    const folders = ['config', 'config/jest', 'scripts', 'scripts/utils'];

    // Make shallow array of files paths
    const files = folders.reduce((files, folder) => {
      console.log(folder);
      return files.concat(
        fs
          .readdirSync(path.join(ownPath, folder))
          // set full path
          .map(file => path.join(ownPath, folder, file))
          // omit dirs from file list
          .filter(file => fs.lstatSync(file).isFile())
      );
    }, []);

    // Ensure that the app folder is clean and we won't override any files
    folders.forEach(verifyAbsent);
    files.forEach(verifyAbsent);

    // Prepare Jest config early in case it throws
    const jestConfig = createJestConfig(
      filePath => path.posix.join('<rootDir>', filePath),
      null,
      paths.srcPaths
    );

    console.log();
    console.log(cyan(`Copying files into ${appPath}`));

    folders.forEach(folder => {
      fs.mkdirSync(path.join(appPath, folder));
    });

    files.forEach(file => {
      let content = fs.readFileSync(file, 'utf8');

      // Skip flagged files
      if (content.match(/\/\/ @remove-file-on-eject/)) {
        return;
      }
      content =
        content
          // Remove dead code from .js files on eject
          .replace(
            /\/\/ @remove-on-eject-begin([\s\S]*?)\/\/ @remove-on-eject-end/gm,
            ''
          )
          // Remove dead code from .applescript files on eject
          .replace(
            /-- @remove-on-eject-begin([\s\S]*?)-- @remove-on-eject-end/gm,
            ''
          )
          .trim() + '\n';
      console.log(`  Adding ${cyan(file.replace(ownPath, ''))} to the project`);
      fs.writeFileSync(file.replace(ownPath, appPath), content);
    });

    if (paths.appConfig.indexOf('node_modules') > -1) {
      fs.copySync(paths.appConfig, path.join(appPath, 'config'));
    }

    console.log();

    const ownPackage = require(path.join(ownPath, 'package.json'));
    const appPackage = require(path.join(appPath, 'package.json'));

    console.log(cyan('Updating the dependencies'));
    const ownPackageName = ownPackage.name;
    if (appPackage.devDependencies) {
      let devDependenciesToAdd = {};

      // We put react-scripts in devDependencies
      if (appPackage.devDependencies[ownPackageName]) {
        console.log(`  Removing ${cyan(ownPackageName)} from devDependencies`);
        delete appPackage.devDependencies[ownPackageName];
      }

      // We also put our own devDependencies in app, so remove them too and replace with contents
      Object.keys(ownPackage.devDependencies).forEach(ownDependency => {
        if (appPackage.devDependencies[ownDependency]) {
          console.log(`  Removing ${cyan(ownDependency)} from devDependencies`);
          delete appPackage.devDependencies[ownDependency];
          let childPackage = require(path.join(
            appPath,
            'node_modules',
            ownDependency,
            'package.json'
          ));
          Object.keys(childPackage.dependencies).forEach(key => {
            // For some reason optionalDependencies end up in dependencies after install
            if (
              childPackage.optionalDependencies &&
              childPackage.optionalDependencies[key]
            ) {
              return;
            }
            console.log(`  Adding ${cyan(key)} to devDependencies`);
            devDependenciesToAdd[key] = childPackage.dependencies[key];
          });
        }
      });

      // Finally eject any template devDependencies use us as a devDependency
      let devDependenciesToRemove = [];

      Object.keys(appPackage.devDependencies).forEach(key => {
        let childPackage = require(path.join(
          appPath,
          'node_modules',
          key,
          'package.json'
        ));
        if (
          childPackage.devDependencies &&
          childPackage.devDependencies[ownPackageName]
        ) {
          console.log(`  Removing ${cyan(key)} from devDependencies`);
          devDependenciesToRemove.push(key);

          Object.keys(childPackage.dependencies).forEach(key => {
            // For some reason optionalDependencies end up in dependencies after install
            if (
              childPackage.optionalDependencies &&
              childPackage.optionalDependencies[key]
            ) {
              return;
            }
            console.log(`  Adding ${cyan(key)} to devDependencies`);
            devDependenciesToAdd[key] = childPackage.dependencies[key];
          });
        }
      });

      // Actually add and delete the selected devDependencies (done subsequently to avoid loop churn)
      Object.assign(appPackage.devDependencies, devDependenciesToAdd);
      devDependenciesToRemove.forEach(key => {
        delete appPackage.devDependencies[key];
      });
    }

    appPackage.dependencies = appPackage.dependencies || {};
    appPackage.devDependencies = appPackage.devDependencies || {};

    if (appPackage.directories && appPackage.directories.config) {
      console.log(
        `  Resetting ${cyan('config')} in package.json ${cyan(
          'directories'
        )} to default`
      );
      appPackage.directories.config = 'config';
    }

    if (appPackage.dependencies[ownPackageName]) {
      console.log(`  Removing ${cyan(ownPackageName)} from dependencies`);
      delete appPackage.dependencies[ownPackageName];
    }

    Object.keys(ownPackage.dependencies).forEach(key => {
      // For some reason optionalDependencies end up in dependencies after install
      if (
        ownPackage.optionalDependencies &&
        ownPackage.optionalDependencies[key]
      ) {
        return;
      }
      console.log(`  Adding ${cyan(key)} to devDependencies`);
      appPackage.devDependencies[key] = ownPackage.dependencies[key];
    });

    // Sort the deps
    const unsortedDependencies = appPackage.dependencies;
    appPackage.dependencies = {};
    Object.keys(unsortedDependencies)
      .sort()
      .forEach(key => {
        appPackage.dependencies[key] = unsortedDependencies[key];
      });

    const unsortedDevDependencies = appPackage.devDependencies;
    appPackage.devDependencies = {};
    Object.keys(unsortedDevDependencies)
      .sort()
      .forEach(key => {
        appPackage.devDependencies[key] = unsortedDevDependencies[key];
      });
    console.log();

    console.log(cyan('Updating the scripts'));
    delete appPackage.scripts['eject'];
    Object.keys(appPackage.scripts).forEach(key => {
      Object.keys(ownPackage.bin).forEach(binKey => {
        if (binKey == 'react-scripts') return; // only find the extended form

        const regex = new RegExp(binKey + ' (\\w+)', 'g');
        if (!regex.test(appPackage.scripts[key])) {
          return;
        }
        appPackage.scripts[key] = appPackage.scripts[key].replace(
          regex,
          'node scripts/$1.js'
        );
        console.log(
          `  Replacing ${cyan(`"${binKey} ${key}"`)} with ${cyan(
            `"node scripts/${key}.js"`
          )}`
        );
      });
    });

    console.log();
    console.log(cyan('Configuring package.json'));
    // Add Jest config
    console.log(`  Adding ${cyan('Jest')} configuration`);
    appPackage.jest = jestConfig;

    fs.writeFileSync(
      path.join(appPath, 'package.json'),
      JSON.stringify(appPackage, null, 2) + os.EOL
    );
    console.log();

    // "Don't destroy what isn't ours"
    if (ownPath.indexOf(appPath) === 0) {
      try {
        // remove react-scripts and react-scripts binaries from app node_modules
        Object.keys(ownPackage.bin).forEach(binKey => {
          fs.removeSync(path.join(appPath, 'node_modules', '.bin', binKey));
        });
        fs.removeSync(ownPath);
      } catch (e) {
        // It's not essential that this succeeds
      }
    }

    if (paths.useYarn) {
      const windowsCmdFilePath = path.join(
        appPath,
        'node_modules',
        '.bin',
        'react-scripts.cmd'
      );
      let windowsCmdFileContent;
      if (process.platform === 'win32') {
        // https://github.com/offgridnetworks/fuse-box-create-react-app/pull/3806#issuecomment-357781035
        // Yarn is diligent about cleaning up after itself, but this causes the react-scripts.cmd file
        // to be deleted while it is running. This trips Windows up after the eject completes.
        // We'll read the batch file and later "write it back" to match npm behavior.
        try {
          windowsCmdFileContent = fs.readFileSync(windowsCmdFilePath);
        } catch (err) {
          // If this fails we're not worse off than if we didn't try to fix it.
        }
      }

      console.log(cyan('Running yarn...'));
      spawnSync('yarnpkg', ['--cwd', process.cwd()], { stdio: 'inherit' });

      if (windowsCmdFileContent && !fs.existsSync(windowsCmdFilePath)) {
        try {
          fs.writeFileSync(windowsCmdFilePath, windowsCmdFileContent);
        } catch (err) {
          // If this fails we're not worse off than if we didn't try to fix it.
        }
      }
    } else {
      console.log(cyan('Running npm install...'));
      spawnSync('npm', ['install', '--loglevel', 'error'], {
        stdio: 'inherit',
      });
    }
    console.log(green('Ejected successfully!'));
    console.log();

    console.log(
      green('Please consider sharing why you ejected in this survey:')
    );
    console.log(green('  http://goo.gl/forms/Bi6CZjk1EqsdelXk1'));
    console.log();
  })
  .catch(err => {
    if (err && err.message) {
      console.log(err.message);
    }
    process.exit(1);
  });
