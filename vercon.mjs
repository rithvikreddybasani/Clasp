#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { diffLines } from "diff";
import chalk from "chalk";
import { Command } from "commander";
import asciiTree from "ascii-tree";

const program = new Command();

class Clasp {
  constructor(repoPath = ".") {
    this.repoPath = path.join(repoPath, ".clasp");
    this.objectsPath = path.join(this.repoPath, "objects");
    this.headPath = path.join(this.repoPath, "HEAD");
    this.indexPath = path.join(this.repoPath, "index");
    this.init();
  }

  async init() {
    await fs.mkdir(this.objectsPath, { recursive: true });
    try {
      await fs.writeFile(this.headPath, "", { flag: "wx" });
      await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: "wx" });
    } catch (error) {
      console.log("Already initialized the .clasp folder");
    }
  }

  hashObject(content) {
    return crypto.createHash("sha1").update(content, "utf-8").digest("hex");
  }

  async updateStagingArea(filepath, fileHash) {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );
    index.push({ path: filepath, hash: fileHash });
    await fs.writeFile(this.indexPath, JSON.stringify(index));
  }

  async add(fileToBeAdded) {
    const fileData = await fs.readFile(fileToBeAdded, { encoding: "utf-8" });
    const fileHash = this.hashObject(fileData);
    console.log(fileHash);
    const newFileHashObjectPath = path.join(this.objectsPath, fileHash);
    await fs.writeFile(newFileHashObjectPath, fileData);
    await this.updateStagingArea(fileToBeAdded, fileHash);
    console.log(`Added ${fileToBeAdded} to the index.`);
  }

  async commit(message) {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );
    const parentCommit = await this.getCurrentHead();
    const commitData = {
      timeStamp: new Date().toISOString(),
      message,
      files: index,
      parent: parentCommit,
    };

    const commitHash = this.hashObject(JSON.stringify(commitData));
    const commitPath = path.join(this.objectsPath, commitHash);
    await fs.writeFile(commitPath, JSON.stringify(commitData));
    await fs.writeFile(this.headPath, commitHash);
    await fs.writeFile(this.indexPath, JSON.stringify([]));
    console.log(`Commit created successfully: ${commitHash}`);
  }

  async getCurrentHead() {
    try {
      return await fs.readFile(this.headPath, { encoding: "utf-8" });
    } catch (error) {
      return null;
    }
  }

  async log() {
    let currentCommitHash = await this.getCurrentHead();
    while (currentCommitHash) {
      const commitData = JSON.parse(
        await fs.readFile(path.join(this.objectsPath, currentCommitHash), {
          encoding: "utf-8",
        })
      );
      console.log(`----------------------------------------------------\n`);
      console.log(
        `Commit: ${currentCommitHash}\nDate: ${commitData.timeStamp}\nCommit Message: ${commitData.message}\n\n`
      );
      currentCommitHash = commitData.parent;
    }
  }

  async showCommitDiff(commitHash) {
    const commitData = JSON.parse(await this.getCommitData(commitHash));
    if (!commitData) {
      console.log("Commit not found");
      return;
    }
    console.log("Changes in the last commit are: ");

    for (const file of commitData.files) {
      console.log(`File: ${file.path}`);
      const fileContent = await this.getFileContent(file.hash);
      console.log(fileContent);
      if (commitData.parent) {
        const parentCommitData = JSON.parse(
          await this.getCommitData(commitData.parent)
        );
        const getParentFileContent = await this.getParentFileContent(
          parentCommitData,
          file.path
        );
        if (getParentFileContent !== undefined) {
          console.log("\nDiff:");
          const diff = diffLines(getParentFileContent, fileContent);

          diff.forEach((part) => {
            if (part.added) {
              process.stdout.write(chalk.green("++" + part.value));
            } else if (part.removed) {
              process.stdout.write(chalk.red("--" + part.value));
            } else {
              process.stdout.write(chalk.grey(part.value));
            }
          });
          console.log("\n");
        } else {
          console.log("New file in this commit\n");
        }
      } else {
        console.log("First commit, no parent\n");
      }
    }
  }

  async getParentFileContent(parentCommitData, filepath) {
    const parentFile = parentCommitData.files.find(
      (file) => file.path === filepath
    );
    if (parentFile) {
      return await this.getFileContent(parentFile.hash);
    }
  }

  async getCommitData(commitHash) {
    const commitPath = path.join(this.objectsPath, commitHash);
    try {
      return await fs.readFile(commitPath, { encoding: "utf-8" });
    } catch (error) {
      console.log("Failed to read the commit data: ", error);
      return null;
    }
  }

  async getFileContent(fileHash) {
    const objectsPath = path.join(this.objectsPath, fileHash);
    return fs.readFile(objectsPath, { encoding: "utf-8" });
  }

  async generateCommitTree() {
    let currentCommitHash = await this.getCurrentHead();
    if (!currentCommitHash) {
      console.log("No commits found");
      return;
    }

    const buildTree = async (commitHash) => {
      const commitData = JSON.parse(
        await fs.readFile(path.join(this.objectsPath, commitHash), {
          encoding: "utf-8",
        })
      );
      let tree = `${commitHash}\n`;
      if (commitData.parent) {
        tree += (await buildTree(commitData.parent))
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n");
      }
      return tree;
    };

    const treeData = await buildTree(currentCommitHash);
    const tree = asciiTree.generate(treeData);
    console.log(tree);
  }
}

program.command("init").action(async () => {
  const clasp = new Clasp();
});

program.command("add <file>").action(async (file) => {
  const clasp = new Clasp();
  await clasp.add(file);
});

program.command("commit <message>").action(async (message) => {
  const clasp = new Clasp();
  await clasp.commit(message);
});

program.command("log").action(async () => {
  const clasp = new Clasp();
  await clasp.log();
});

program.command("show <commitHash>").action(async (commitHash) => {
  const clasp = new Clasp();
  await clasp.showCommitDiff(commitHash);
});

program.command("tree").action(async () => {
  const clasp = new Clasp();
  await clasp.generateCommitTree();
});

program.parse(process.argv);
