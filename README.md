# 🦜🕸️LangGraph.js

[![Docs](https://img.shields.io/badge/docs-latest-blue)](https://langchain-ai.github.io/langgraphjs/)
![Version](https://img.shields.io/npm/v/@langchain/langgraph?logo=npm)
[![Downloads](https://img.shields.io/npm/dm/@langchain/langgraph)](https://www.npmjs.com/package/@langchain/langgraph)
[![Open Issues](https://img.shields.io/github/issues-raw/langchain-ai/langgraphjs)](https://github.com/langchain-ai/langgraphjs/issues)
[![](https://dcbadge.vercel.app/api/server/6adMQxSpJS?compact=true&style=flat)](https://discord.com/channels/1038097195422978059/1170024642245832774)

⚡ Building language agents as graphs ⚡

## Overview

LangGraph is a library for building stateful, multi-actor applications with LLMs, built on top of [LangChain.js](https://github.com/langchain-ai/langchainjs).
It extends the [LangChain Expression Language](https://js.langchain.com/docs/expression_language/) with the ability to coordinate multiple chains (or actors) across multiple steps of computation in a cyclic manner.
It is inspired by [Pregel](https://research.google/pubs/pub37252/) and [Apache Beam](https://beam.apache.org/).
The current interface exposed is one inspired by [NetworkX](https://networkx.org/documentation/latest/).

It lets you add **cycles** as graphs to your LLM application.
Cycles are important for agent-like behaviors, where you call an LLM in a loop, asking it what action to take next.

> Looking for the Python version? Click [here](https://github.com/langchain-ai/langgraph) ([py docs](https://langchain-ai.github.io/langgraph/)).

## Installation

```bash
npm install @langchain/langgraph
```

## Quick start

One of the central concepts of LangGraph is state. Each graph execution creates a state that is passed between nodes in the graph as they execute, and each node updates this internal state with its return value after it executes. The way that the graph updates its internal state is defined by either the type of graph chosen or a custom function.

State in LangGraph can be pretty general, but to keep things simpler to start, we'll show off an example where the graph's state is limited to a list of chat messages. This is convenient when using LangGraph with LangChain chat models because we can return chat model output directly.

For this example, we'll install a couple prerequisites. First, install the LangChain OpenAI integration package:

```shell
npm i @langchain/openai
```

We also need to export some environment variables:

```shell
export OPENAI_API_KEY=sk-...
```

And now we're ready! The graph below contains a single node called `"model"` that executes a chat model, then returns the result, and streams the tokens as they are generated:

```typescript {id=1}
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { END, START, MessageGraph } from "@langchain/langgraph";

const model = new ChatOpenAI({
  temperature: 0,
  // Set streaming to true to enable streaming
  streaming: true,
});

const graph = new MessageGraph()
  .addNode("model", async (state: BaseMessage[]) => {
    const response = await model.invoke(state);
    return [response];
  })
  .addEdge("model", END)
  .addEdge(START, "model");

const runnable = graph.compile();
```

Let's run it and stream the tokens as they are generated!

```typescript {id=1}
const inputs = [new HumanMessage("What is 1 + 1?")];

for await (const step of await runnable.stream(inputs)) {
  console.log(step);
}
```

This will stream the tokens as they are generated by the model, allowing you to see the model's output in real-time.

## Conditional edges

Now, let's move onto something a little bit less trivial. Because math can be difficult for LLMs, let's allow the LLM to conditionally call a calculator node using tool calling.

We'll recreate our graph with an additional `"calculator"` that will take the result of the most recent message, if it is a math expression, and calculate the result.
We'll also bind the calculator to the OpenAI model as a tool to allow the model to optionally use the tool if it deems necessary:

```typescript {id=2}
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { Calculator } from "@langchain/community/tools/calculator";
import { END, START, MessageGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const calculator = new Calculator();
const tools = [calculator];
const toolNode = new ToolNode<BaseMessage[]>(tools);
const model = new ChatOpenAI({
  temperature: 0,
  // Set streaming to true to enable streaming
  streaming: true,
}).bindTools(tools);

const graph = new MessageGraph()
  .addNode("model", async (state: BaseMessage[]) => {
    const response = await model.invoke(state);
    return [response];
  })
  .addNode("calculator", toolNode)
  .addEdge(START, "model")
  .addEdge("calculator", END);
```

Now let's think - what do we want to have happen?

- If the `"model"` node returns a message expecting a tool call, we want to execute the `"calculator"` node
- If not, we can just end execution

We can achieve this using **conditional edges**, which route execution to a node based on the current state using a function.

Here's what that looks like:

```typescript {id=2}
const router = (state: BaseMessage[]) => {
  const toolCalls = (state[state.length - 1] as AIMessage).tool_calls ?? [];
  if (toolCalls.length) {
    return "calculator";
  } else {
    return "end";
  }
};

graph.addConditionalEdges("model", router, {
  calculator: "calculator",
  end: END,
});
```

If the model output contains a tool call, we move to the `"calculator"` node. Otherwise, we end.

Great! Now all that's left is to compile the graph and try it out. Math-related questions are routed to the calculator tool:

```typescript {id=2}
const runnable = graph.compile();
const mathResponse = await runnable.invoke(new HumanMessage("What is 1 + 1?"));
console.log(mathResponse);
```

While conversational responses are outputted directly:

```typescript {id=2}
const otherResponse = await runnable.invoke(
  new HumanMessage("What is your name?")
);
console.log(otherResponse);
```

## Cycles

Now, let's go over a more general example with a cycle. We will recreate the [`AgentExecutor`](https://js.langchain.com/docs/modules/agents/concepts#agentexecutor) class from LangChain, using function calling.

The benefits of creating it with LangGraph is that it is more modifiable.

We will need to install some LangChain packages:

```shell
npm install @langchain/community
```

We also need additional environment variables.

```shell
export OPENAI_API_KEY=sk-...
export TAVILY_API_KEY=tvly-...
```

Optionally, we can set up [LangSmith](https://docs.smith.langchain.com/) for best-in-class observability.

```shell
export LANGCHAIN_TRACING_V2="true"
export LANGCHAIN_API_KEY=ls__...
```

### Set up the tools

As above, we will first define the tools we want to use.
For this simple example, we will use a simple search tool via Tavily.
However, it is really easy to create your own tools - see documentation [here](https://js.langchain.com/docs/modules/agents/tools/dynamic) on how to do that.

```typescript {id=3}
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

const tools = [new TavilySearchResults({ maxResults: 1 })];
```

We can now wrap these tools in a ToolNode, which simply takes in an AIMessage with tool_calls, calls those tool, and returns ToolMessages with the observations.

```typescript {id=3}
import { ToolNode } from "@langchain/langgraph/prebuilt";

const toolNode = new ToolNode<{ messages: BaseMessage[] }>(tools);
```

### Set up the model

Now we need to load the chat model we want to use.
This time, we'll use the function calling interface. This walkthrough will use OpenAI, but we can choose any model that supports OpenAI function calling.

```typescript {id=3}
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  temperature: 0,
  // Set streaming to true to enable streaming
  streaming: true,
});
```

After we've done this, we should make sure the model knows that it has these tools available to call.
We can do this by binding the tools to the model.

```typescript {id=3}
const boundModel = model.bindTools(tools);
```

### Define the agent state

This time, we'll use the more general `StateGraph`.
This graph is parameterized by a state object that it passes around to each node.
Remember that each node then returns operations to update that state.
These operations can either SET specific attributes on the state (e.g. overwrite the existing values) or ADD to the existing attribute.
Whether to set or add is denoted in the state object you construct the graph with.

For this example, the state we will track will just be a list of messages.
We want each node to just add messages to that list.
Therefore, we will define the state as follows:

```typescript {id=3}
import { BaseMessage } from "@langchain/core/messages";
import { StateGraphArgs } from "@langchain/langgraph";

interface IState {
  messages: BaseMessage[];
}

const graphState: StateGraphArgs<IState>["channels"] = {
  messages: {
    value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => [],
  },
};
```

### Define the nodes

We now need to define a few different nodes in our graph.
In `langgraph`, a node can be either a function or a [runnable](https://js.langchain.com/docs/expression_language/).
There are two main nodes we need for this:

1. The agent: responsible for deciding what (if any) actions to take.
2. A function to invoke tools: if the agent decides to take an action, this node will then execute that action.

We will also need to define some edges.
Some of these edges may be conditional.
The reason they are conditional is that based on the output of a node, one of several paths may be taken.
The path that is taken is not known until that node is run (the LLM decides).

1. Conditional Edge: after the agent is called, we should either:
   a. If the agent said to take an action, then the function to invoke tools should be called
   b. If the agent said that it was finished, then it should finish
2. Normal Edge: after the tools are invoked, it should always go back to the agent to decide what to do next

Let's define the nodes, as well as a function to decide how what conditional edge to take.

```typescript {id=3}
import { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";

// Define the function that determines whether to continue or not
const shouldContinue = (state: IState) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  // If there is no function call, then we finish
  if (
    !("function_call" in lastMessage.additional_kwargs) ||
    !lastMessage.additional_kwargs.function_call
  ) {
    return "end";
  }
  // Otherwise if there is, we continue
  return "continue";
};

// Define the function that calls the model
const callModel = async (state: IState, config?: RunnableConfig) => {
  const { messages } = state;
  // You can use a prompt here to tweak model behavior.
  // You can also just pass messages to the model directly.
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant."],
    new MessagesPlaceholder("messages"),
  ]);
  const response = await prompt.pipe(boundModel).invoke({ messages }, config);
  // We return a list, because this will get added to the existing list
  return { messages: [response] };
};
```

### Define the graph

We can now put it all together and define the graph!

```typescript {id=3}
// Define a new graph
const workflow = new StateGraph<IState>({
  channels: graphState,
}) // Define the two nodes we will cycle between
  .addNode("agent", callModel)
  .addNode("tools", toolNode)

  // Set the entrypoint as `agent`
  // This means that this node is the first one called
  .addEdge(START, "agent")
  // We now add a conditional edge
  .addConditionalEdges(
    // First, we define the start node. We use `agent`.
    // This means these are the edges taken after the `agent` node is called.
    "agent",
    // Next, we pass in the function that will determine which node is called next.
    shouldContinue,
    // Finally we pass in a mapping.
    // The keys are strings, and the values are other nodes.
    // END is a special node marking that the graph should finish.
    // What will happen is we will call `should_continue`, and then the output of that
    // will be matched against the keys in this mapping.
    // Based on which one it matches, that node will then be called.
    {
      // If `tools`, then we call the tool node.
      continue: "tools",
      // Otherwise we finish.
      end: END,
    }
  )
  // We now add a normal edge from `tools` to `agent`.
  // This means that after `tools` is called, `agent` node is called next.
  .addEdge("tools", "agent");

// Finally, we compile it!
// This compiles it into a LangChain Runnable,
// meaning you can use it as you would any other runnable
const app = workflow.compile();
```

### Use it!

We can now use it!
This now exposes the [same interface](https://js.langchain.com/docs/expression_language/) as all other LangChain runnables.
This runnable accepts a list of messages.

```typescript {id=3}
import { HumanMessage } from "@langchain/core/messages";

const inputs = {
  messages: [new HumanMessage("what is the weather in sf")],
};

// Stream all events of the output
for await (const event of await app.streamEvents(
  inputs,
  { version: "v1" },
  {
    includeTypes: ["llm"],
  }
)) {
  console.log(event);
}

// Or get just the final result
const result = await app.invoke(inputs);
console.log(result);
```

See a LangSmith trace of this run [here](https://smith.langchain.com/public/144af8a3-b496-43aa-ba9d-f0d5894196e2/r).

## When to Use

When should you use this versus [LangChain Expression Language](https://js.langchain.com/docs/expression_language/)?

If you need cycles.

Langchain Expression Language allows you to easily define chains (DAGs) but does not have a good mechanism for adding in cycles.
`langgraph` adds that syntax.

## Documentation

### Tutorials

Learn to build with LangGraph through guided examples in the [LangGraph Tutorials](https://langchain-ai.github.io/langgraphjs/tutorials/).

We recommend starting with the [Introduction to LangGraph](https://langchain-ai.github.io/langgraphjs/tutorials/introduction/) before trying out the more advanced guides.

### How-to Guides

The [LangGraph how-to guides](https://langchain-ai.github.io/langgraphjs/how-tos/) show how to accomplish specific things within LangGraph, from streaming, to adding memory & persistence, to common design patterns (branching, subgraphs, etc.), these are the place to go if you want to copy and run a specific code snippet.

### Conceptual Guides

The [Conceptual Guides](https://langchain-ai.github.io/langgraphjs/concepts/) provide in-depth explanations of the key concepts and principles behind LangGraph, such as nodes, edges, state and more.

### Reference

LangGraph's API has a few important classes and methods that are all covered in the [Reference Documents](https://langchain-ai.github.io/langgraphjs/reference/graphs/). Check these out to see the specific function arguments and simple examples of how to use the graph APIs or to see some of the higher-level prebuilt components.
