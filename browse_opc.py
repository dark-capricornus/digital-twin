import asyncio
from asyncua import Client

async def main():
    client = Client("opc.tcp://127.0.0.1:4840/freeopcua/server/")
    try:
        await client.connect()
        print("Connected.")
        
        # Browse VirtualPLC
        root = client.nodes.objects
        
        # Find VirtualPLC
        virtual_plc = await root.get_child(["2:VirtualPLC"])
        print(f"VirtualPLC node: {virtual_plc}")
        
        # Check Control
        try:
            control = await virtual_plc.get_child(["2:Control"])
            print("Found 2:Control")
            for child in await control.get_children():
                print(f"  - {await child.read_browse_name()}: {child.nodeid}")
        except Exception as e:
            print(f"Control folder error: {e}")
            
        # Check Commands
        try:
            commands = await virtual_plc.get_child(["2:Commands"])
            print("Found 2:Commands")
            for child in await commands.get_children():
                print(f"  - {await child.read_browse_name()}: {child.nodeid}")
        except Exception as e:
            print(f"Commands folder error: {e}")
            
        # Check Devices CNC_01 Interactions
        try:
            devices = await virtual_plc.get_child(["2:Devices"])
            cnc = await devices.get_child(["2:CNC_01"])
            inputs = await cnc.get_child(["2:Inputs"])
            print("Found CNC_01 Inputs:")
            for child in await inputs.get_children():
                print(f"  - {await child.read_browse_name()}: {child.nodeid}")
        except Exception as e:
            print(f"CNC_01 Inputs error: {e}")
            
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        await client.disconnect()

asyncio.run(main())
