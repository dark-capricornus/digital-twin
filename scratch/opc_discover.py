import asyncio
from asyncua import Client

async def main():
    url = "opc.tcp://127.0.0.1:4840"
    client = Client(url=url)
    try:
        await client.connect()
        print(f"Connected to {url}")
        
        # Get Namespace
        ns_index = await client.get_namespace_index("http://digitaltwin.plc")
        print(f"Namespace Index for 'http://digitaltwin.plc': {ns_index}")
        
        # Browse CNC_01 Status
        node = await client.nodes.root.get_child(["0:Objects", f"{ns_index}:VirtualPLC", f"{ns_index}:Devices", f"{ns_index}:CNC_01", f"{ns_index}:Status", f"{ns_index}:SpindleRPM"])
        print(f"Found Node: {node}")
        print(f"Full NodeId: {node.nodeid}")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
