import type { JsonSchema } from "../../validation/validators.ts";

export const projectInitSchema: JsonSchema = {
	type: "object",
	properties: {
		projectName: {
			type: "string",
			minLength: 1,
			maxLength: 200,
		},
		backlogDirectory: {
			type: "string",
			maxLength: 200,
		},
		configLocation: {
			type: "string",
			enum: ["folder", "root"],
		},
		taskPrefix: {
			type: "string",
			maxLength: 20,
		},
	},
	required: ["projectName"],
	additionalProperties: false,
};
