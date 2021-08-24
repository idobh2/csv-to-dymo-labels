const Dymo = require("dymojs");
const { promises: fs } = require("fs");
const { promisify } = require("util");
const path = require("path");
const fetch = require("node-fetch");
const { parseStringPromise } = require("xml2js");
const csv = require("csv");

const DRY_RUN = true;

const getImagesDictionary = async () => {
	const images = await fs.readFile(path.resolve(__dirname, "input/images.csv"), "utf8");
	const imageTable = await promisify(csv.parse)(images, {
		columns: ["name", "link"],
	});
	const imageDictionary = (await Promise.all(imageTable.map(imageEntry => {
		return fetch(imageEntry.link)
			.then(r => r.buffer())
			.then(b => ({ [imageEntry.name]: b.toString("base64") }))
	})))
		.reduce((a, b) => ({ ...a, ...b }), {});

	return imageDictionary;
};

const isLabelEntryEmpty = (entry) => {
	if (!entry) {
		return true;
	}
	if (!entry.value) {
		return true;
	}
	return false;
}

const getLabelPairs = async () => {
	const labels = await fs.readFile(path.resolve(__dirname, "input/labels.csv"), "utf8");
	const labelsTable = await promisify(csv.parse)(labels, {
		columns: ["type", "value", "image"],
		from: 2,
	});
	const pairs = [];
	while (labelsTable.length) {
		let top = labelsTable.shift();
		let bottom = labelsTable.shift();
		if (isLabelEntryEmpty(bottom)) {
			bottom = null;
		}
		if (isLabelEntryEmpty(top)) {
			if (bottom) {
				top = bottom;
				bottom = null;
			} else {
				top = null; // empty label? why?
			}
		}
		if (top) { // at least top section to be qualify as pair 
			pairs.push([top, bottom]);
		}
	}
	return pairs;
}

const templateToLabel = (template, pair, images) => {
	const [top, bottom] = pair;
	if (bottom) {
		template = template.replace(/<!-- section2_begin -->\r?\n\s*/, "").replace(/<!-- section2_end -->\r?\n\s*/, "");
	} else {
		template = template.replace(/<!-- section2_begin -->.*<!-- section2_end -->/s, "");
	}
	let label = template
		.replace(/{type1}/, top.type)
		.replace(/{value1}/, top.value)
		.replace(/{image1}/, images[top.image]);

	if (bottom) {
		label = label
			.replace(/{type2}/, bottom.type)
			.replace(/{value2}/, bottom.value)
			.replace(/{image2}/, images[bottom.image]);
	}
	return label;
}

(async () => {
	const [images, labels] = await Promise.all([
		getImagesDictionary(),
		getLabelPairs(),
	])

	const dymo = new Dymo();
	const printersXml = JSON.parse(await dymo.getPrinters());
	const printers = await parseStringPromise(printersXml);
	const { Printers: { LabelWriterPrinter: [{ Name: [printerName = null] = [] } = {}] = [] } = {} } = printers ?? {};
	let templateXml = await fs.readFile("./template.dymo", "utf8");
	for (const pair of labels) {
		const label = templateToLabel(templateXml, pair, images);
		if (DRY_RUN) {
			const buffer = await dymo.renderLabel(label);
			await fs.writeFile(path.resolve(__dirname, "output", `label_${labels.indexOf(pair)}.png`), buffer, "base64");
		} else if (printerName) {
			await dymo.print(printerName, label);
		} else {
			throw new Error("Couldn't find a printer, and not in dry-run mode");
		}
	}
})().catch(console.error);
